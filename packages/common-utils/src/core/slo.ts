import { z } from 'zod/v3';

import { FIXED_TIME_BUCKET_EXPR_ALIAS } from '@/core/renderChartConfig';
import { buildSearchChartConfig } from '@/core/searchChartConfig';
import {
  buildSloLatencyGoodSql,
  getSloDurationValueExpression,
  getSloLatencyEligibleFilter,
} from '@/core/sloLatency';
import { escapeSqlString } from '@/core/utils';
import {
  getSloBurnThreshold,
  getSloBurnWindowMs,
  getSloWindowMs,
  SLO_BURN_CONDITIONS,
  SLO_MAX_GROUPS,
  SloBurnCondition,
  SloBurnWindow,
  SloDefinition,
  SloHistoryBucket,
  SloIndicator,
  SloWindow,
} from '@/slo';
import {
  BuilderChartConfigWithDateRange,
  DerivedColumn,
  DisplayType,
  Filter,
  isTraceSource,
  SQLInterval,
  TSource,
} from '@/types';

/** The parts of an SLO a query needs. */
export type SloQueryDefinition = Pick<SloDefinition, 'indicator'> & {
  groupBy?: string | null;
};

const SLO_GROUP_ALIAS = 'slo_group';

/** Group values are compared as text, whatever the expression's type. */
function getSloGroupExpression(groupBy: string): string {
  return `toString(${groupBy})`;
}

/** Scopes a query or a drill-down to one group of a grouped SLO. */
export function getSloGroupFilter(groupBy: string, value: string): Filter {
  return {
    type: 'sql',
    condition: `${getSloGroupExpression(groupBy)} = '${escapeSqlString(
      value,
    )}'`,
  };
}

/** Limits a query to the groups an SLO tracks; no groups matches nothing. */
function getSloGroupsFilter(groupBy: string, values: string[]): Filter {
  if (values.length === 0) return { type: 'sql', condition: '0' };
  const list = values.map(value => `'${escapeSqlString(value)}'`).join(', ');
  return {
    type: 'sql',
    condition: `${getSloGroupExpression(groupBy)} IN (${list})`,
  };
}

/** The SLO's group-by expression, or undefined when it has none. */
export function getSloGroupBy(
  slo: Pick<SloQueryDefinition, 'groupBy'>,
): string | undefined {
  return slo.groupBy?.trim() || undefined;
}

/**
 * The key a grouped SLO's alert keeps a group's state under, in the
 * `expression:value` form of threshold alert groups.
 */
export function getSloGroupKey(groupBy: string, value: string): string {
  return `${groupBy}:${value}`;
}

/**
 * The group value in an alert group key, or undefined when the key is not
 * one of the SLO's groups (it was ungrouped, or grouped by something else).
 */
export function getSloGroupValue(
  slo: Pick<SloQueryDefinition, 'groupBy'>,
  key: string | null | undefined,
): string | undefined {
  const groupBy = getSloGroupBy(slo);
  if (groupBy == null || !key) return undefined;
  const prefix = getSloGroupKey(groupBy, '');
  return key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
}

/** SQL for good events: written by the user, or derived for latency. */
export function getSloGoodSql(indicator: SloIndicator): string {
  return indicator.template === 'latency' && indicator.latency
    ? buildSloLatencyGoodSql(indicator.latency)
    : (indicator.good ?? '');
}

export type SloBurnRule = (SloBurnCondition & { threshold: number })[];

/**
 * The burn rule behind the "burning" state, the burn-rate chart and the
 * alert, with each condition's threshold for the SLO's window. The 1h
 * condition comes first.
 */
export function getSloBurnRule(window: SloWindow): SloBurnRule {
  return SLO_BURN_CONDITIONS.map(condition => ({
    ...condition,
    threshold: getSloBurnThreshold(condition, window),
  }));
}

export function getSloWindowRange(window: SloWindow, now: Date): [Date, Date] {
  return [new Date(now.getTime() - getSloWindowMs(window)), now];
}

export function getSloBurnRange(
  window: SloBurnWindow,
  now: Date,
): [Date, Date] {
  return [new Date(now.getTime() - getSloBurnWindowMs(window)), now];
}

const SLO_BURN_BUCKET: SQLInterval = '5 minute';
const SLO_BURN_BUCKET_MS = 5 * 60 * 1000;

/**
 * Range of the burn query: the longest burn window (6h), ending on a
 * 5-minute boundary, so every burn window is a whole number of buckets.
 */
export function getSloBurnQueryRange(now: Date): [Date, Date] {
  const end =
    Math.floor(now.getTime() / SLO_BURN_BUCKET_MS) * SLO_BURN_BUCKET_MS;
  return getSloBurnRange('6h', new Date(end));
}

/** Buckets for history charts: at most 336 (7d) or 720 (30d) points. */
export function getSloHistoryGranularity(window: SloWindow): SQLInterval {
  return window === '7d' ? '30 minute' : '1 hour';
}

/**
 * Rows the SLO counts as bad. ClickHouse's countIf treats a NULL condition as
 * false, so an event whose good condition is NULL is not good; the ifNull
 * keeps that event in the bad set instead of dropping it.
 */
export function getSloBadFilter(goodSql: string): Filter {
  return { type: 'sql', condition: `NOT ifNull((${goodSql}), 0)` };
}

/**
 * The user's filters plus, for a latency SLO on a cast duration, the guard
 * that leaves out events without one. Every query takes its filters here.
 */
export function getSloEligibleFilters(indicator: SloIndicator): Filter[] {
  const filters: Filter[] = [...(indicator.eligible.filters ?? [])];
  if (indicator.template === 'latency' && indicator.latency) {
    const guard = getSloLatencyEligibleFilter(indicator.latency);
    if (guard) filters.push(guard);
  }
  return filters;
}

function countIf(alias: string, condition: string): DerivedColumn {
  return {
    aggFn: 'count',
    aggCondition: condition,
    aggConditionLanguage: 'sql',
    valueExpression: '',
    alias,
  };
}

/**
 * How a query treats a grouped SLO's groups. Without a scope it counts all
 * of the SLO's events together.
 */
export type SloGroupScope =
  /** One group's events. */
  | { group: string }
  /**
   * Per group: the SLO_MAX_GROUPS busiest plus one, which tells the caller
   * there are more, or the given groups.
   */
  | { byGroup: true; groups?: string[] };

/**
 * The one query behind every SLO number: eligible and good counts over the
 * range, or per bucket with `granularity`, for the whole SLO or by group.
 * Rows come from buildSearchChartConfig, as in Search, so a drill-down with
 * the same where clause and filters sees the same events.
 */
export function buildSloCountsChartConfig({
  slo,
  source,
  dateRange,
  granularity,
  scope,
}: {
  slo: SloQueryDefinition;
  source: TSource;
  dateRange: [Date, Date];
  granularity?: SQLInterval;
  scope?: SloGroupScope;
}): BuilderChartConfigWithDateRange {
  const groupBy = getSloGroupBy(slo);
  const filters = getSloEligibleFilters(slo.indicator);
  const byGroup = groupBy != null && scope != null && 'byGroup' in scope;
  if (groupBy != null && scope != null) {
    if ('group' in scope) filters.push(getSloGroupFilter(groupBy, scope.group));
    else if (scope.groups) {
      filters.push(getSloGroupsFilter(groupBy, scope.groups));
    }
  }
  const config = buildSearchChartConfig(source, {
    where: slo.indicator.eligible.where,
    whereLanguage: slo.indicator.eligible.whereLanguage,
    filters,
    select: [
      countIf('slo_eligible', ''),
      countIf('slo_good', getSloGoodSql(slo.indicator)),
    ],
    groupBy:
      groupBy != null && byGroup
        ? [
            {
              valueExpression: getSloGroupExpression(groupBy),
              alias: SLO_GROUP_ALIAS,
            },
          ]
        : undefined,
    // The busiest groups first, with one row more than are tracked.
    orderBy:
      byGroup && granularity == null
        ? [{ ordering: 'DESC', valueExpression: 'slo_eligible' }]
        : undefined,
    displayType: granularity != null ? DisplayType.Line : DisplayType.Table,
    dateRange,
    dateRangeStartInclusive: true,
    dateRangeEndInclusive: false,
    granularity,
  });
  return {
    ...config,
    dateRange,
    ...(byGroup && granularity == null
      ? { limit: { limit: SLO_MAX_GROUPS + 1 } }
      : {}),
  };
}

/**
 * Eligible and good counts per 5-minute bucket over the burn query's range.
 * Each burn window is summed from these buckets (getSloBurnCounts), so the
 * query is a plain bucketed count that a materialized view can serve.
 */
export function buildSloBurnChartConfig({
  slo,
  source,
  now,
  scope,
}: {
  slo: SloQueryDefinition;
  source: TSource;
  now: Date;
  scope?: SloGroupScope;
}): BuilderChartConfigWithDateRange {
  return buildSloCountsChartConfig({
    slo,
    source,
    dateRange: getSloBurnQueryRange(now),
    granularity: SLO_BURN_BUCKET,
    scope,
  });
}

/** Distinct groups among the SLO's eligible events in the range. */
export function buildSloGroupCountChartConfig({
  slo,
  source,
  dateRange,
}: {
  slo: SloQueryDefinition & { groupBy: string };
  source: TSource;
  dateRange: [Date, Date];
}): BuilderChartConfigWithDateRange {
  const config = buildSearchChartConfig(source, {
    where: slo.indicator.eligible.where,
    whereLanguage: slo.indicator.eligible.whereLanguage,
    filters: getSloEligibleFilters(slo.indicator),
    select: [
      {
        aggFn: 'count_distinct',
        aggCondition: '',
        aggConditionLanguage: 'sql',
        valueExpression: getSloGroupExpression(slo.groupBy),
        alias: 'slo_group_count',
      },
    ],
    displayType: DisplayType.Table,
    dateRange,
    dateRangeStartInclusive: true,
    dateRangeEndInclusive: false,
  });
  return { ...config, dateRange };
}

/** Every row of the source in the range, before the eligibility filter. */
export function buildSloSourceTotalChartConfig({
  source,
  dateRange,
}: {
  source: TSource;
  dateRange: [Date, Date];
}): BuilderChartConfigWithDateRange {
  const config = buildSearchChartConfig(source, {
    where: '',
    whereLanguage: 'sql',
    select: [countIf('slo_total', '')],
    displayType: DisplayType.Table,
    dateRange,
    dateRangeStartInclusive: true,
    dateRangeEndInclusive: false,
  });
  return { ...config, dateRange };
}

// 64-bit counts arrive as strings (output_format_json_quote_64bit_integers).
const count = z.coerce.number().catch(0);

const countsRowSchema = z.object({
  slo_eligible: count,
  slo_good: count,
});

/** Eligible and good events over a range. */
export type SloCounts = { eligible: number; good: number };

export function parseSloCountsRow(rows: Record<string, unknown>[]): SloCounts {
  const row = countsRowSchema.parse(rows[0] ?? {});
  return { eligible: row.slo_eligible, good: row.slo_good };
}

/** Counts in the long and short windows of one burn condition. */
export type SloBurnCounts = SloCounts & {
  shortEligible: number;
  shortGood: number;
};

export function parseSloTotalRow(rows: Record<string, unknown>[]): number {
  return z.object({ slo_total: count }).parse(rows[0] ?? {}).slo_total;
}

const historyRowSchema = z
  .object({
    slo_eligible: count,
    slo_good: count,
    [FIXED_TIME_BUCKET_EXPR_ALIAS]: z.string(),
  })
  .transform(
    ({ [FIXED_TIME_BUCKET_EXPR_ALIAS]: bucket, slo_eligible, slo_good }) => ({
      ts: new Date(bucket).getTime(),
      eligible: slo_eligible,
      good: slo_good,
    }),
  );

export function parseSloHistoryRows(
  rows: Record<string, unknown>[],
): SloHistoryBucket[] {
  return rows
    .map(row => historyRowSchema.safeParse(row))
    .flatMap(result => (result.success ? [result.data] : []))
    .filter(bucket => Number.isFinite(bucket.ts))
    .sort((a, b) => a.ts - b.ts);
}

// `slo_group` is SLO_GROUP_ALIAS, the group's column in a query by group.
const groupValueSchema = z.object({ slo_group: z.coerce.string() });
const groupRowSchema = groupValueSchema.extend({
  slo_eligible: count,
  slo_good: count,
});

/** Counts per group, in the query's order (busiest first). */
export function parseSloGroupRows(
  rows: Record<string, unknown>[],
): (SloCounts & { value: string })[] {
  return rows.flatMap(row => {
    const parsed = groupRowSchema.safeParse(row);
    return parsed.success
      ? [
          {
            value: parsed.data.slo_group,
            eligible: parsed.data.slo_eligible,
            good: parsed.data.slo_good,
          },
        ]
      : [];
  });
}

/** Buckets per group, from a bucketed query by group. */
export function parseSloGroupHistoryRows(
  rows: Record<string, unknown>[],
): Map<string, SloHistoryBucket[]> {
  const byGroup = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const parsed = groupValueSchema.safeParse(row);
    if (!parsed.success) continue;
    const value = parsed.data.slo_group;
    const groupRows = byGroup.get(value);
    if (groupRows) groupRows.push(row);
    else byGroup.set(value, [row]);
  }
  return new Map(
    [...byGroup].map(([value, groupRows]) => [
      value,
      parseSloHistoryRows(groupRows),
    ]),
  );
}

/** The distinct group count from buildSloGroupCountChartConfig's row. */
export function parseSloGroupCountRow(rows: Record<string, unknown>[]): number {
  return z.object({ slo_group_count: count }).parse(rows[0] ?? {})
    .slo_group_count;
}

/** Eligible and good events over all buckets, which is the whole range. */
export function sumSloBuckets(buckets: SloHistoryBucket[]): SloCounts {
  return buckets.reduce(
    (sum, bucket) => ({
      eligible: sum.eligible + bucket.eligible,
      good: sum.good + bucket.good,
    }),
    { eligible: 0, good: 0 },
  );
}

/**
 * Counts for the long and short window of each condition, from the burn
 * query's buckets; every window ends where the query's range ends.
 */
export function getSloBurnCounts(
  buckets: SloHistoryBucket[],
  conditions: Pick<SloBurnCondition, 'window' | 'shortWindow'>[],
  end: Date,
): SloBurnCounts[] {
  const sumSince = (window: SloBurnWindow) => {
    const start = end.getTime() - getSloBurnWindowMs(window);
    return sumSloBuckets(
      buckets.filter(b => b.ts >= start && b.ts < end.getTime()),
    );
  };
  return conditions.map(condition => {
    const short = sumSince(condition.shortWindow);
    return {
      ...sumSince(condition.window),
      shortEligible: short.eligible,
      shortGood: short.good,
    };
  });
}

/**
 * Search state for an SLO's bad events, from the same filters every SLO query
 * uses plus the bad condition. Latency SLOs sort slowest first, and a
 * duration read from an attribute is added next to the default columns.
 */
export function buildSloBadEventsSearch(
  slo: SloQueryDefinition,
  defaultSelect?: string,
  /** Scopes the drill-down to one group of a grouped SLO. */
  group?: string,
): {
  where: string;
  whereLanguage: 'lucene' | 'sql';
  filters: Filter[];
  orderBy?: string;
  select?: string;
} {
  const { eligible, template, latency } = slo.indicator;
  const groupBy = getSloGroupBy(slo);
  const latencyValue =
    template === 'latency' && latency
      ? getSloDurationValueExpression(latency)
      : undefined;
  return {
    where: eligible.where,
    whereLanguage: eligible.whereLanguage,
    filters: [
      ...getSloEligibleFilters(slo.indicator),
      ...(groupBy != null && group != null
        ? [getSloGroupFilter(groupBy, group)]
        : []),
      getSloBadFilter(getSloGoodSql(slo.indicator)),
    ],
    ...(latencyValue != null ? { orderBy: `${latencyValue} DESC` } : {}),
    ...(latencyValue != null && latency && !latency.numeric && defaultSelect
      ? {
          select: `${defaultSelect}, ${latencyValue} AS duration_${latency.unit}`,
        }
      : {}),
  };
}

/** Default good condition for the availability template. */
export function buildSloAvailabilityCondition(
  source: TSource,
): string | undefined {
  if (isTraceSource(source)) {
    return source.statusCodeExpression
      ? `${source.statusCodeExpression} != 'Error'`
      : undefined;
  }
  if ('severityTextExpression' in source && source.severityTextExpression) {
    return `lower(${source.severityTextExpression}) NOT IN ('error', 'fatal', 'critical')`;
  }
  return undefined;
}
