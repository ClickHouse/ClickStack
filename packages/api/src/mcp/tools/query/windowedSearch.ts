import type {
  ClickHouseSettings,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  generateTimeWindowsDescending,
  type TimeWindow,
} from '@hyperdx/common-utils/dist/core/searchWindows';
import type {
  BuilderChartConfigWithDateRange,
  QuerySettings,
} from '@hyperdx/common-utils/dist/types';
import { trace } from '@opentelemetry/api';

import type { ClickhouseClient } from '@/clickhouse';
import {
  MCP_TIMEOUT_GRACE_MS,
  MCP_TOOL_TIMEOUT_MS,
  runWithTimeout,
} from '@/mcp/utils/timeout';
import { isQueryTimeoutError } from '@/tasks/checkAlerts/errors';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

/**
 * Wall-clock budget for the whole scan. Under MCP_TOOL_TIMEOUT_MS because the
 * window that runs out of time only returns at the limit, and the response
 * (plus denoise sampling, when requested) still has to fit the tool budget.
 */
export const SEARCH_TIME_BUDGET_MS = MCP_TOOL_TIMEOUT_MS - 5_000;

/** Below this, a new window could not read enough to be worth starting. */
const MIN_WINDOW_BUDGET_MS = 1_000;

const partialResultsCounter = getCounter('hyperdx.mcp.search.partial_results', {
  description:
    'clickstack_search calls that returned partial rows instead of failing, labeled by why the scan stopped.',
});

type SearchRow = Record<string, string | number>;
type IsoRange = { startTime: string; endTime: string };

export type SearchCoverage = {
  /** time_budget: ran out of time. query_error: an older window's query failed. */
  reason: 'time_budget' | 'query_error';
  requestedRange: IsoRange;
  /** Fully scanned, newest first. Null when not even the newest window finished. */
  coveredRange: IsoRange | null;
  /** The window that was cut off; its rows are only those read before the limit. */
  incompleteRange?: IsoRange;
};

const toIsoRange = (start: Date, end: Date): IsoRange => ({
  startTime: start.toISOString(),
  endTime: end.toISOString(),
});

function mergeWindowResults(
  results: ResponseJSON<SearchRow>[],
): ResponseJSON<SearchRow> {
  if (results.length === 1) return results[0];
  const data = results.flatMap(r => r.data);
  const statistics = results.reduce(
    (sum, r) => ({
      elapsed: sum.elapsed + (r.statistics?.elapsed ?? 0),
      rows_read: sum.rows_read + (r.statistics?.rows_read ?? 0),
      bytes_read: sum.bytes_read + (r.statistics?.bytes_read ?? 0),
    }),
    { elapsed: 0, rows_read: 0, bytes_read: 0 },
  );
  return {
    meta: results.find(r => r.data.length > 0)?.meta ?? results[0]?.meta ?? [],
    data,
    rows: data.length,
    statistics,
  };
}

/**
 * Run a search newest-first over the app's progressive time windows (see
 * useOffsetPaginatedQuery), stopping once `maxResults` rows are found or the
 * time budget is spent. Each window runs with timeout_overflow_mode=break
 * capped at the remaining budget, so the window that runs out of time still
 * returns the rows ClickHouse read. Throws only when the newest window fails.
 */
export async function runWindowedSearch({
  clickhouseClient,
  metadata,
  config,
  querySettings,
  clickhouseSettings,
  maxResults,
  abortSignal,
}: {
  clickhouseClient: ClickhouseClient;
  metadata: Metadata;
  config: BuilderChartConfigWithDateRange;
  querySettings: QuerySettings | undefined;
  clickhouseSettings: ClickHouseSettings;
  maxResults: number;
  abortSignal?: AbortSignal;
}): Promise<{ result: ResponseJSON<SearchRow>; partial?: SearchCoverage }> {
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
  const [startDate, endDate] = config.dateRange;
  const windows = generateTimeWindowsDescending(startDate, endDate);

  const results: ResponseJSON<SearchRow>[] = [];
  let rowCount = 0;
  let coveredStart: Date | undefined;
  let incompleteWindow: TimeWindow | undefined;
  let stopReason: SearchCoverage['reason'] | undefined;

  for (const window of windows) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < MIN_WINDOW_BUDGET_MS || abortSignal?.aborted) {
      stopReason = 'time_budget';
      break;
    }
    const maxExecutionSec = Math.floor(remainingMs / 100) / 10;
    const queryStart = Date.now();

    let outcome;
    try {
      outcome = await runWithTimeout(
        signal =>
          clickhouseClient.queryChartConfig({
            config: {
              ...config,
              dateRange: [window.startTime, window.endTime],
              // Windows share boundaries; leave the shared one to the newer window.
              ...(window.windowIndex > 0
                ? { dateRangeEndInclusive: false }
                : {}),
              limit: { limit: maxResults - rowCount, offset: 0 },
            },
            metadata,
            querySettings,
            opts: {
              clickhouse_settings: {
                ...clickhouseSettings,
                max_execution_time: maxExecutionSec,
                timeout_overflow_mode: 'break',
              },
              abort_signal: abortSignal
                ? AbortSignal.any([signal, abortSignal])
                : signal,
            },
          }),
        // Backstop for stalls the server-side cap cannot cover (e.g. network).
        { timeoutMs: remainingMs + MCP_TIMEOUT_GRACE_MS },
      );
    } catch (e) {
      // Older windows are wider, so they are likelier to hit memory or
      // network errors; keep the rows the newer windows already found.
      if (results.length === 0) throw e;
      stopReason = isQueryTimeoutError(e) ? 'time_budget' : 'query_error';
      logger.warn(
        { err: e, windowIndex: window.windowIndex },
        'clickstack_search older window failed; returning partial results',
      );
      incompleteWindow = window;
      break;
    }
    if (outcome.timedOut) {
      stopReason = 'time_budget';
      incompleteWindow = window;
      break;
    }

    const result = outcome.value;
    results.push(result);
    rowCount += result.data.length;
    // Break mode returns no error when it stops early, so reaching the cap is
    // the only signal the window was cut off. Wall-clock time is needed too:
    // after a break, the JSON body's `statistics.elapsed` can read ~0.
    const elapsedSec = Math.max(
      result.statistics?.elapsed ?? 0,
      (Date.now() - queryStart) / 1000,
    );
    if (elapsedSec >= maxExecutionSec) {
      stopReason = 'time_budget';
      incompleteWindow = window;
      break;
    }
    coveredStart = window.startTime;
    if (rowCount >= maxResults) break;
  }

  const partial: SearchCoverage | undefined = stopReason
    ? {
        reason: stopReason,
        requestedRange: toIsoRange(startDate, endDate),
        coveredRange: coveredStart ? toIsoRange(coveredStart, endDate) : null,
        ...(incompleteWindow
          ? {
              incompleteRange: toIsoRange(
                incompleteWindow.startTime,
                incompleteWindow.endTime,
              ),
            }
          : {}),
      }
    : undefined;

  const span = trace.getActiveSpan();
  span?.setAttribute('mcp.search.windows_total', windows.length);
  span?.setAttribute('mcp.search.windows_scanned', results.length);
  span?.setAttribute('mcp.search.partial', partial != null);
  if (partial) {
    span?.setAttribute(
      'mcp.search.covered_ms',
      coveredStart ? endDate.getTime() - coveredStart.getTime() : 0,
    );
    span?.setAttribute('mcp.search.partial_reason', partial.reason);
    partialResultsCounter.add(1, {
      reason: partial.reason,
      coverage: partial.coveredRange ? 'some' : 'none',
    });
  }

  return { result: mergeWindowResults(results), partial };
}

/** Tells the agent what a partial search covered and what to call next. */
export function partialSearchHint(partial: SearchCoverage): string {
  const budget = `${SEARCH_TIME_BUDGET_MS / 1000}s`;
  const { coveredRange, incompleteRange, requestedRange, reason } = partial;
  if (coveredRange) {
    const stopped =
      reason === 'query_error'
        ? 'the query for an older window failed'
        : `the search stopped at its ${budget} time budget`;
    const cutOff =
      incompleteRange && reason === 'time_budget'
        ? ` Rows from ${incompleteRange.startTime} to ${incompleteRange.endTime} are only those read before the limit, so they may repeat on the next call.`
        : '';
    return (
      `Partial result: ${stopped}. ` +
      `Rows are complete (newest first) from ${coveredRange.startTime} to ${coveredRange.endTime}.${cutOff} ` +
      `For older events, call again with startTime=${requestedRange.startTime} endTime=${coveredRange.startTime}, ` +
      'or add filters so each window scans faster.'
    );
  }
  const range = incompleteRange ?? requestedRange;
  const endMs = new Date(range.endTime).getTime();
  const spanMs = endMs - new Date(range.startTime).getTime();
  const narrowStart = new Date(endMs - Math.max(60_000, spanMs / 4));
  return (
    `Partial result: the search ran out of its ${budget} time budget before finishing the newest window ` +
    `(${range.startTime} to ${range.endTime}). Returned rows are only those read before the limit and may not be the newest. ` +
    `Narrow the range (e.g. startTime=${narrowStart.toISOString()} endTime=${range.endTime}) ` +
    'or add filters to reduce the rows scanned.'
  );
}
