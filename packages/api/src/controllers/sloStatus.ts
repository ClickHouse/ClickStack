import PQueue from '@esm2cjs/p-queue';
import { withQueryAttribution } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getSloWindowRange } from '@hyperdx/common-utils/dist/core/slo';
import {
  compareSloGroupsWorstFirst,
  deriveGroupedSloState,
  deriveSloGroupState,
  deriveSloState,
} from '@hyperdx/common-utils/dist/core/sloStats';
import type { SloStatus } from '@hyperdx/common-utils/dist/slo';

import { getSloQueryContext } from '@/controllers/slo';
import {
  buildSloStatus,
  computeSloBurn,
  computeSloWindow,
  hasSloQueryTime,
  type SloBurnNumbers,
  SloQueryDeadlineError,
  type SloWindowNumbers,
} from '@/controllers/sloStatusQueries';
import Slo, { ISlo } from '@/models/slo';
import {
  getCounter,
  setBusinessContext,
  withSpan,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';

/**
 * How old the burn numbers get before the refresh recomputes them. Each
 * check of an ungrouped SLO's burn alerts writes them too, so the refresh
 * fills in only when no alert check did in the last 5 minutes. A grouped
 * SLO's alerts write only their groups' numbers.
 */
const SLO_BURN_MAX_AGE_MS = 5 * 60 * 1000;
/**
 * How old the window numbers (SLI, budget) get. Their query reads the whole
 * 7 or 30 day window, and a budget that long barely moves in minutes.
 */
const SLO_WINDOW_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Limits for one refresh run. It runs beside the alert evaluation in the
 * check-alerts task, so every query ends by the deadline, well within the
 * task's one-minute cadence; whatever is left waits for the next run.
 */
const SLO_REFRESH_DEADLINE_MS = 40_000;
const SLO_REFRESH_CLIENT_TIMEOUT_MS = 30_000;
const SLO_REFRESH_CONCURRENCY = 4;
const SLO_REFRESH_BATCH_LIMIT = 200;

const refreshCounter = getCounter('hyperdx.slo.refresh', {
  description: 'SLO status refreshes, by outcome',
});

/**
 * Stores the burn numbers an SLO's alert check computed, so the list shows
 * the alert's own verdict: for an ungrouped SLO its burn numbers, for a
 * grouped one each group's. The window numbers stay as the refresh stored
 * them; until it has, there is nothing to add to. Returns the stored
 * snapshot.
 */
export async function recordSloAlertBurn(
  slo: ISlo,
  burn: Partial<SloBurnNumbers>,
  now: Date,
): Promise<SloStatus | null> {
  const previous = slo.status;
  if (previous?.windowEvaluatedAt == null) return null;
  const groups = previous.groups
    ?.map(group => {
      const groupBurn = burn.groups?.get(group.value);
      if (groupBurn == null) return group;
      const next = { ...group, burn: groupBurn };
      return { ...next, state: deriveSloGroupState(next) };
    })
    .sort(compareSloGroupsWorstFirst);
  const overall = { ...previous, burn: burn.burn ?? previous.burn };
  const status: SloStatus = {
    ...overall,
    // Only new overall burn numbers make the snapshot's burn part fresh.
    evaluatedAt: burn.burn != null ? now.toISOString() : previous.evaluatedAt,
    ...(groups != null ? { groups } : {}),
    // A failing window query keeps its error until the refresh clears it.
    state:
      previous.state === 'error'
        ? 'error'
        : groups != null
          ? deriveGroupedSloState(overall, groups)
          : deriveSloState(overall),
  };
  await Slo.updateOne(
    { _id: slo._id, updatedAt: slo.updatedAt },
    { $set: { status } },
    { timestamps: false },
  );
  return status;
}

const getErrorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

function getStoredWindow(
  status: SloStatus | null | undefined,
): SloWindowNumbers | null {
  if (status?.windowEvaluatedAt == null) return null;
  return {
    eligible: status.eligible,
    good: status.good,
    windowStart: status.windowStart,
    windowEnd: status.windowEnd,
    windowEvaluatedAt: status.windowEvaluatedAt,
    durationMs: status.durationMs,
    rowsRead: status.rowsRead,
    ...(status.groups != null
      ? {
          groups: status.groups.map(({ value, eligible, good }) => ({
            value,
            eligible,
            good,
          })),
          groupCount: status.groupCount,
        }
      : {}),
  };
}

function getStoredBurn(
  status: SloStatus | null | undefined,
): SloBurnNumbers | null {
  if (status?.burn == null) return null;
  return {
    burn: status.burn,
    ...(status.groups != null
      ? { groups: new Map(status.groups.map(g => [g.value, g.burn])) }
      : {}),
  };
}

const isOlderThan = (iso: string | null | undefined, now: Date, ms: number) =>
  iso == null || now.getTime() - Date.parse(iso) >= ms;

/**
 * Computes and stores one snapshot: the window numbers and the burn numbers
 * that are due, keeping the stored ones that are not. The window comes
 * first, since it decides which groups a grouped SLO tracks. A failed
 * evaluation keeps the last known numbers, marks the state as error and
 * records when it last succeeded, so an SLO that cannot be evaluated never
 * reads as healthy.
 */
async function refreshSloStatus(
  slo: ISlo,
  now: Date,
  deadline: number,
): Promise<'success' | 'error' | 'deferred'> {
  const previous = slo.status;
  let status: SloStatus;
  let outcome: 'success' | 'error' = 'success';
  try {
    const ctx = await getSloQueryContext(
      slo.team.toString(),
      slo.source.toString(),
      SLO_REFRESH_CLIENT_TIMEOUT_MS,
    );
    let window = getStoredWindow(previous);
    const windowDue =
      window == null ||
      isOlderThan(previous?.windowEvaluatedAt, now, SLO_WINDOW_MAX_AGE_MS);
    if (windowDue) window = await computeSloWindow(slo, ctx, now, deadline);
    if (window == null) return 'deferred';
    let burn = getStoredBurn(previous);
    let evaluatedAt = previous?.evaluatedAt ?? now.toISOString();
    // New window numbers can bring new groups, which need burn numbers too.
    if (
      burn == null ||
      windowDue ||
      isOlderThan(previous?.evaluatedAt, now, SLO_BURN_MAX_AGE_MS)
    ) {
      burn = await computeSloBurn(
        slo,
        ctx,
        now,
        window.groups?.map(g => g.value),
        deadline,
      );
      evaluatedAt = now.toISOString();
    }
    status = buildSloStatus(slo, window, burn, evaluatedAt, now);
  } catch (e) {
    // Out of time mid-way: nothing is stored, and the next run retries.
    if (e instanceof SloQueryDeadlineError) return 'deferred';
    outcome = 'error';
    const windowRange = getSloWindowRange(slo.window, now);
    status = {
      eligible: previous?.eligible ?? 0,
      good: previous?.good ?? 0,
      bad: previous?.bad ?? 0,
      sli: previous?.sli ?? null,
      errorBudget: previous?.errorBudget ?? 0,
      budgetRemaining: previous?.budgetRemaining ?? null,
      budgetRemainingEvents: previous?.budgetRemainingEvents ?? 0,
      burn: previous?.burn ?? [],
      windowStart: previous?.windowStart ?? windowRange[0].toISOString(),
      windowEnd: previous?.windowEnd ?? windowRange[1].toISOString(),
      windowEvaluatedAt: previous?.windowEvaluatedAt ?? null,
      durationMs: previous?.durationMs ?? 0,
      rowsRead: previous?.rowsRead ?? 0,
      ...(previous?.groups != null
        ? { groups: previous.groups, groupCount: previous.groupCount }
        : {}),
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      state: 'error',
      evaluatedAt: now.toISOString(),
      error: getErrorMessage(e).slice(0, 2000),
    };
  }
  // Matching updatedAt drops the snapshot when the SLO was edited while it
  // was computed, and not touching timestamps keeps updatedAt meaning the
  // last edit rather than the last refresh.
  await Slo.updateOne(
    { _id: slo._id, updatedAt: slo.updatedAt },
    { $set: { status } },
    { timestamps: false },
  );
  return outcome;
}

/**
 * Refreshes snapshots whose burn numbers are older than SLO_BURN_MAX_AGE_MS
 * or whose window numbers are older than SLO_WINDOW_MAX_AGE_MS, new SLOs and
 * then the stalest first, with a few queries at a time. Every query is
 * bounded by what is left of the deadline, so the run ends by it. Never
 * throws: a failure is recorded on the SLO it belongs to.
 */
export async function refreshDueSloStatuses(now = new Date()): Promise<void> {
  await withSpan('sloRefreshBatch', async span => {
    const before = (ms: number) => new Date(now.getTime() - ms).toISOString();
    // A snapshot without window numbers (its first refresh failed) is
    // retried with its burn numbers, not on every run.
    const due = await Slo.find({
      $or: [
        { 'status.evaluatedAt': { $exists: false } },
        { 'status.evaluatedAt': { $lt: before(SLO_BURN_MAX_AGE_MS) } },
        { 'status.windowEvaluatedAt': { $lt: before(SLO_WINDOW_MAX_AGE_MS) } },
      ],
    })
      .sort({ 'status.evaluatedAt': 1 })
      .limit(SLO_REFRESH_BATCH_LIMIT)
      .lean();
    span.setAttribute('hyperdx.slo.refresh.due', due.length);

    const deadline = Date.now() + SLO_REFRESH_DEADLINE_MS;
    const queue = new PQueue({ concurrency: SLO_REFRESH_CONCURRENCY });
    let deferred = 0;
    for (const slo of due) {
      void queue.add(async () => {
        if (!hasSloQueryTime(deadline)) {
          deferred++;
          return;
        }
        await withSpan(
          'sloRefresh',
          async sloSpan => {
            setBusinessContext({ teamId: slo.team.toString() });
            const outcome = await withQueryAttribution(
              {
                surface: 'slo',
                label: slo._id.toString(),
                source: slo.source.toString(),
              },
              () => refreshSloStatus(slo, now, deadline),
            );
            sloSpan.setAttribute('hyperdx.slo.refresh.outcome', outcome);
            refreshCounter.add(1, { outcome });
          },
          {
            attributes: {
              'hyperdx.slo.id': slo._id.toString(),
              'hyperdx.team.id': slo.team.toString(),
            },
          },
        ).catch(e =>
          logger.error({ error: getErrorMessage(e) }, 'SLO refresh failed'),
        );
      });
    }
    await queue.onIdle();
    if (deferred > 0) refreshCounter.add(deferred, { outcome: 'deferred' });
    span.setAttribute('hyperdx.slo.refresh.deferred', deferred);
  }).catch(e =>
    logger.error({ error: getErrorMessage(e) }, 'SLO refresh batch failed'),
  );
}
