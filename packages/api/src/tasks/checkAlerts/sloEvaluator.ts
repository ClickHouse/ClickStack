import { tryOptimizeConfigWithMaterializedView } from '@hyperdx/common-utils/dist/core/materializedViews';
import {
  getSloBurnQueryRange,
  getSloGroupBy,
  getSloGroupKey,
} from '@hyperdx/common-utils/dist/core/slo';
import {
  computeSloBurnFromRows,
  computeSloGroupBurnFromRows,
  getSloBurnSeverity,
  isSloBurnConditionMet,
} from '@hyperdx/common-utils/dist/core/sloStats';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  getSloBurnCondition,
  getSloBurnWindowMs,
  SLO_BURN_CONDITIONS,
  SLO_GROUP_MIN_EVENTS,
  type SloAlertRule,
  type SloBurnStats,
  type SloBurnWindow,
} from '@hyperdx/common-utils/dist/slo';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { performance } from 'perf_hooks';
import { serializeError } from 'serialize-error';

import { recordSloAlertBurn } from '@/controllers/sloStatus';
import type { SloBurnNumbers } from '@/controllers/sloStatusQueries';
import { AlertSource, AlertState } from '@/models/alert';
import { attributesToGroupValues, IAlertHistory } from '@/models/alertHistory';
import type { ISlo } from '@/models/slo';
import type { ISource } from '@/models/source';
import {
  computeHistoryMapKey,
  extractGroupKeyFromMapKey,
  makeQueryAlertError,
} from '@/tasks/checkAlerts';
import type {
  AlertEvaluationContext,
  AlertEvaluator,
} from '@/tasks/checkAlerts/evaluators';
import { AlertTaskType } from '@/tasks/checkAlerts/providers';
import logger from '@/utils/logger';

export const SLO_BURN_RATE_EVALUATOR_NAME = 'slo_burn_rate';

/** What one check judges: the whole SLO, or one group of a grouped SLO. */
type SloBurnCheck = {
  /** The alert history key: empty for the whole SLO. */
  key: string;
  burn: SloBurnStats[];
  /** False for a group with too few events in the window to judge. */
  alertable: boolean;
  attributes: Record<string, string>;
};

/**
 * Runs the burn query, from a materialized view of the source when one
 * covers it, as the SLO's other queries do: the context's config is
 * unoptimized. A failure is recorded as a query error or timeout, as for
 * threshold alerts, and returns null.
 */
async function queryBurnRows(ctx: AlertEvaluationContext, source: ISource) {
  const queryStartedAt = performance.now();
  try {
    const mvSource =
      source.kind === SourceKind.Log || source.kind === SourceKind.Trace
        ? source
        : undefined;
    const config =
      isBuilderChartConfig(ctx.chartConfig) &&
      mvSource?.materializedViews?.length
        ? await tryOptimizeConfigWithMaterializedView(
            ctx.chartConfig,
            ctx.metadata,
            ctx.clickhouseClient,
            undefined,
            mvSource,
          )
        : ctx.chartConfig;
    const result = await ctx.clickhouseClient.queryChartConfig({
      config,
      metadata: ctx.metadata,
      querySettings: source.querySettings,
    });
    return result.data;
  } catch (e) {
    ctx.executionErrors.push(
      makeQueryAlertError(e, ctx.clickhouseClient.requestTimeoutMs),
    );
    return null;
  } finally {
    ctx.evaluationAnalytics.queryDurationMs = Math.round(
      performance.now() - queryStartedAt,
    );
  }
}

/** The checks for this run, with the burn numbers to store on the SLO. */
function getSloBurnChecks(
  slo: ISlo,
  rows: Record<string, unknown>[],
  now: Date,
): { checks: SloBurnCheck[]; burn: Partial<SloBurnNumbers> } {
  const groupBy = getSloGroupBy(slo);
  if (groupBy == null) {
    const burn = computeSloBurnFromRows(rows, slo, now);
    return {
      checks: [{ key: '', burn, alertable: true, attributes: {} }],
      burn: { burn },
    };
  }
  const tracked = slo.status?.groups ?? [];
  const groups = computeSloGroupBurnFromRows(
    rows,
    slo,
    now,
    tracked.map(g => g.value),
  );
  return {
    checks: tracked.map(group => ({
      key: getSloGroupKey(groupBy, group.value),
      burn: groups.get(group.value) ?? [],
      // The SLO shows such a group as insufficient data, and so it waits.
      alertable: group.eligible >= SLO_GROUP_MIN_EVENTS,
      attributes: { [groupBy]: group.value },
    })),
    burn: { groups },
  };
}

/** The start of a burn window that ends at `end`. */
const getBurnStart = (
  end: Date,
  window: SloBurnWindow = SLO_BURN_CONDITIONS[0].window,
) => new Date(end.getTime() - getSloBurnWindowMs(window));

/**
 * Records one check of this alert's rule, notifies when a burn starts, and
 * returns the check's history. A burn that goes on notifies once, not on
 * every check; the resolve notification follows the threshold path.
 */
async function runSloBurnCheck(
  ctx: AlertEvaluationContext,
  rule: SloAlertRule,
  { key, burn, alertable, attributes }: SloBurnCheck,
  end: Date,
): Promise<IAlertHistory> {
  // The burn numbers cover both rules; this alert fires on its own.
  const condition = burn.find(c => c.rule === rule);
  const value = condition ? getSloBurnSeverity([condition]) : 0;
  const met =
    alertable && condition != null && isSloBurnConditionMet(condition);
  // The rule's long window is the period the notification links to.
  const startTime = getBurnStart(end, getSloBurnCondition(rule).window);
  const history = ctx.getOrCreateHistory(key);
  history.lastValues.push({ count: value, startTime });
  const previous = ctx.previousMap.get(computeHistoryMapKey(ctx.alert.id, key));
  if (met) {
    history.counts += 1;
    history.state = AlertState.ALERT;
    // A resolve names the group from the last history that alerted.
    history.groupValues = attributesToGroupValues(attributes);
    // Sent when the burn starts, or on the first check after a silence that
    // held it back has ended.
    const notified =
      previous?.state === AlertState.ALERT && previous.fired === true;
    history.fired =
      notified ||
      (await ctx.trySendNotification({
        state: AlertState.ALERT,
        group: key,
        totalCount: value,
        startTime,
        attributes,
        sloBurn: burn,
      }));
  }
  await ctx.sendNotificationIfResolved(previous, history, key);
  return history;
}

/**
 * Resolves what alerted before and is not checked now: a group the SLO no
 * longer tracks, or the whole SLO's state once it is grouped (and each
 * group's once it is not).
 */
async function resolveUnchecked(
  ctx: AlertEvaluationContext,
  checked: Set<string>,
  end: Date,
): Promise<IAlertHistory[]> {
  const histories: IAlertHistory[] = [];
  for (const [mapKey, previous] of ctx.previousMap) {
    const key = extractGroupKeyFromMapKey(mapKey, ctx.alert.id);
    if (
      checked.has(key) ||
      // Not this alert's history.
      mapKey !== computeHistoryMapKey(ctx.alert.id, key) ||
      (previous.state !== AlertState.ALERT &&
        previous.state !== AlertState.PENDING)
    ) {
      continue;
    }
    const history = ctx.getOrCreateHistory(key);
    history.lastValues.push({ count: 0, startTime: getBurnStart(end) });
    await ctx.sendNotificationIfResolved(previous, history, key);
    histories.push(history);
  }
  return histories;
}

/**
 * Evaluation of the fast and slow burn alerts an SLO owns. The chart config
 * the provider builds counts eligible and good events per 5 minutes over the
 * slow burn's 6 hours, by group for a grouped SLO, so each check computes
 * both rules' numbers. The alert fires when its own rule's condition holds,
 * for the SLO or for each of its groups with enough events, and resolves
 * soon after the short window stops burning. Each check also stores the
 * burn numbers on the SLO, so the SLO list shows the alerts' own verdict.
 */
export const sloBurnRateEvaluator: AlertEvaluator = {
  name: SLO_BURN_RATE_EVALUATOR_NAME,
  appliesTo: alert => alert.source === AlertSource.SLO,
  evaluate: async ctx => {
    const { alert, details } = ctx;
    if (details.taskType !== AlertTaskType.SLO) {
      throw new Error('SLO alert without SLO details');
    }
    const { slo, source } = details;
    // A grouped SLO's alert checks the groups its status tracks; until the
    // status refresh has picked them, there is nothing to check.
    if (getSloGroupBy(slo) != null && !slo.status?.groups?.length) return;
    const rows = await queryBurnRows(ctx, source);
    if (rows == null) return;
    const now = ctx.chartConfig.dateRange?.[1] ?? ctx.dateRange[1];
    const end = getSloBurnQueryRange(now)[1];
    const { checks, burn } = getSloBurnChecks(slo, rows, now);

    try {
      const status = await recordSloAlertBurn(slo, burn, new Date());
      // A resolve message reads the SLO's numbers, so they are this check's.
      if (status != null) slo.status = status;
    } catch (e) {
      // The SLO list catches up on its next refresh; alerting goes on.
      logger.error(
        { error: serializeError(e), alertId: alert.id },
        'Failed to store SLO burn numbers',
      );
    }

    const rule = alert.sloRule ?? 'fastBurn';
    const histories: IAlertHistory[] = [];
    for (const check of checks) {
      histories.push(await runSloBurnCheck(ctx, rule, check, end));
    }
    const checked = new Set(checks.map(c => c.key));
    histories.push(...(await resolveUnchecked(ctx, checked, end)));
    ctx.evaluationAnalytics.backfilledBuckets = 0;
    await ctx.persistHistories(histories);
  },
};
