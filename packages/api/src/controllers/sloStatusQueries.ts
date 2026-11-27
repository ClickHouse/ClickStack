import {
  buildSloBurnChartConfig,
  buildSloCountsChartConfig,
  buildSloGroupCountChartConfig,
  getSloBurnRule,
  getSloGroupBy,
  getSloWindowRange,
  parseSloCountsRow,
  parseSloGroupCountRow,
  parseSloGroupRows,
  type SloCounts,
} from '@hyperdx/common-utils/dist/core/slo';
import {
  compareSloGroupsWorstFirst,
  computeSloBurnFromRows,
  computeSloBurnStats,
  computeSloGroupBurnFromRows,
  computeSloStats,
  deriveGroupedSloState,
  deriveSloGroupState,
  deriveSloState,
} from '@hyperdx/common-utils/dist/core/sloStats';
import {
  SLO_MAX_GROUPS,
  type SloBurnStats,
  type SloGroupStatus,
  type SloStatus,
} from '@hyperdx/common-utils/dist/slo';

import { runSloQuery, SloQueryContext } from '@/controllers/slo';
import type { ISlo } from '@/models/slo';

/** Longest a status query may run, and the least time worth starting one. */
const SLO_QUERY_TIMEOUT_MS = 30_000;
const SLO_MIN_QUERY_MS = 5_000;

type SloDefinitionFields = Pick<
  ISlo,
  'indicator' | 'target' | 'window' | 'groupBy'
>;

/** The part of a snapshot the window queries produce. */
export type SloWindowNumbers = Pick<
  SloStatus,
  | 'eligible'
  | 'good'
  | 'windowStart'
  | 'windowEnd'
  | 'windowEvaluatedAt'
  | 'durationMs'
  | 'rowsRead'
  | 'groupCount'
> & {
  /** Grouped SLOs: the tracked groups' counts, busiest first. */
  groups?: (SloCounts & { value: string })[];
};

/** The part of a snapshot the burn queries produce. */
export type SloBurnNumbers = {
  burn: SloBurnStats[];
  /** Grouped SLOs: each tracked group's burn numbers. */
  groups?: Map<string, SloBurnStats[]>;
};

/** No time is left before the deadline for the next query. */
export class SloQueryDeadlineError extends Error {}

/** Time is left before the deadline for at least one more query. */
export function hasSloQueryTime(deadline: number): boolean {
  return (
    Math.min(SLO_QUERY_TIMEOUT_MS, deadline - Date.now()) >= SLO_MIN_QUERY_MS
  );
}

/** Timeout for the next query, bounded by the deadline when there is one. */
function getQueryTimeout(deadline: number | undefined): number | undefined {
  if (deadline == null) return undefined;
  if (!hasSloQueryTime(deadline)) throw new SloQueryDeadlineError();
  return Math.min(SLO_QUERY_TIMEOUT_MS, deadline - Date.now());
}

/**
 * Eligible and good events over the SLO window, overall and, for a grouped
 * SLO, for its busiest groups, with what the queries cost.
 */
export async function computeSloWindow(
  slo: SloDefinitionFields,
  ctx: SloQueryContext,
  now: Date,
  deadline?: number,
): Promise<SloWindowNumbers> {
  const { source } = ctx;
  const dateRange = getSloWindowRange(slo.window, now);
  const cost = { durationMs: 0, rowsRead: 0 };
  const run = async (config: Parameters<typeof runSloQuery>[1]) => {
    const result = await runSloQuery(ctx, config, getQueryTimeout(deadline));
    cost.durationMs += result.durationMs;
    cost.rowsRead += result.rowsRead;
    return result.rows;
  };
  const { eligible, good } = parseSloCountsRow(
    await run(buildSloCountsChartConfig({ slo, source, dateRange })),
  );
  const groupBy = getSloGroupBy(slo);
  let groups: SloWindowNumbers['groups'];
  let groupCount: number | undefined;
  if (groupBy != null) {
    const rows = parseSloGroupRows(
      await run(
        buildSloCountsChartConfig({
          slo,
          source,
          dateRange,
          scope: { byGroup: true },
        }),
      ),
    );
    groups = rows.slice(0, SLO_MAX_GROUPS);
    groupCount = rows.length;
    // One row more than the cap: count them all, to show how many are left.
    if (rows.length > SLO_MAX_GROUPS) {
      groupCount = parseSloGroupCountRow(
        await run(
          buildSloGroupCountChartConfig({
            slo: { ...slo, groupBy },
            source,
            dateRange,
          }),
        ),
      );
    }
  }
  return {
    eligible,
    good,
    windowStart: dateRange[0].toISOString(),
    windowEnd: dateRange[1].toISOString(),
    windowEvaluatedAt: now.toISOString(),
    ...cost,
    ...(groups != null ? { groups, groupCount } : {}),
  };
}

/** Burn numbers overall and, for a grouped SLO, for the given groups. */
export async function computeSloBurn(
  slo: SloDefinitionFields,
  ctx: SloQueryContext,
  now: Date,
  groupValues: string[] | undefined,
  deadline?: number,
): Promise<SloBurnNumbers> {
  const { source } = ctx;
  const overall = await runSloQuery(
    ctx,
    buildSloBurnChartConfig({ slo, source, now }),
    getQueryTimeout(deadline),
  );
  const burn = computeSloBurnFromRows(overall.rows, slo, now);
  if (getSloGroupBy(slo) == null || !groupValues?.length) return { burn };
  const grouped = await runSloQuery(
    ctx,
    buildSloBurnChartConfig({
      slo,
      source,
      now,
      scope: { byGroup: true, groups: groupValues },
    }),
    getQueryTimeout(deadline),
  );
  return {
    burn,
    groups: computeSloGroupBurnFromRows(grouped.rows, slo, now, groupValues),
  };
}

/** Each tracked group with its numbers and state, worst first. */
function buildSloGroups(
  slo: SloDefinitionFields,
  groups: NonNullable<SloWindowNumbers['groups']>,
  groupsBurn: Map<string, SloBurnStats[]> | undefined,
): SloGroupStatus[] {
  // A group the burn numbers lack has no events in the burn windows.
  const noBurn = computeSloBurnStats(
    [],
    getSloBurnRule(slo.window),
    slo.target,
  );
  return groups
    .map(({ value, eligible, good }) => {
      const stats = computeSloStats(
        { eligible, good },
        groupsBurn?.get(value) ?? noBurn,
        slo.target,
      );
      return { ...stats, value, state: deriveSloGroupState(stats) };
    })
    .sort(compareSloGroupsWorstFirst);
}

/** A snapshot from window numbers and burn numbers taken at `evaluatedAt`. */
export function buildSloStatus(
  slo: SloDefinitionFields,
  window: SloWindowNumbers,
  burn: SloBurnNumbers,
  evaluatedAt: string,
  now: Date,
): SloStatus {
  const { groups: windowGroups, ...windowFields } = window;
  const stats = computeSloStats(
    { eligible: window.eligible, good: window.good },
    burn.burn,
    slo.target,
  );
  const groups =
    windowGroups != null
      ? buildSloGroups(slo, windowGroups, burn.groups)
      : undefined;
  return {
    ...windowFields,
    ...stats,
    state:
      groups != null
        ? deriveGroupedSloState(stats, groups)
        : deriveSloState(stats),
    evaluatedAt,
    lastSuccessAt: now.toISOString(),
    ...(groups != null ? { groups } : {}),
    error: null,
  };
}
