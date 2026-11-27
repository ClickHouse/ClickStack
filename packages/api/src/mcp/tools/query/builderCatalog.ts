/**
 * Shared "prefer the builder tools over raw SQL" steering, defined once so the
 * server instructions, the clickstack_sql description, and the builder tools'
 * descriptions can't drift apart.
 */

/** Bulleted list of the builder (non-SQL) query tools and what they're for. */
export const BUILDER_TOOLS_LIST = [
  '  • clickstack_service_health — per-service throughput, errors, latency vs yesterday, ranked',
  '  • clickstack_table — aggregations, top-N, single-value KPIs, breakdowns',
  '  • clickstack_timeseries — trends / metrics over time',
  '  • clickstack_search — browsing individual log/trace rows',
  '  • clickstack_event_patterns — recurring log/event pattern discovery',
  '  • clickstack_event_deltas — attributes that differ between two row groups',
  '  • clickstack_emerging_signals — patterns new or gone vs a baseline window',
  '  • clickstack_trace_waterfall — one trace as a parent/child span tree',
  '  • clickstack_trace_top_time_consuming_ops — slowest child operations in a trace',
].join('\n');

/** When raw SQL is actually warranted. */
export const SQL_FALLBACK_CRITERIA =
  'joins across sources or tables, window functions or per-row ordering, ' +
  'aggregating an already-aggregated result, unregistered tables, or ' +
  'summary metrics (metricTables.summary)';

/** Needs the builder tools already cover, so they never justify raw SQL. */
export const NOT_REASONS_TO_USE_SQL = [
  '  • HAVING → clickstack_table `having`',
  '  • JSON, regex, or derived fields → groupBy / valueExpression expressions',
  '  • Conditional counts or two windows → per-item `where` or multiIf in groupBy',
  '  • One trace with its logs → clickstack_trace_waterfall (includeLogs)',
  '  • Child-span time breakdown → clickstack_trace_top_time_consuming_ops',
].join('\n');

/**
 * Reciprocal nudge dropped into each builder tool's description. Keep it
 * generic so a single string works for every builder tool.
 */
export const PREFER_BUILDER_OVER_SQL_NUDGE =
  'PREFER THIS over clickstack_sql. Use SQL only for ' +
  `${SQL_FALLBACK_CRITERIA}. ` +
  'For needs builders already cover, see the server instructions.';
