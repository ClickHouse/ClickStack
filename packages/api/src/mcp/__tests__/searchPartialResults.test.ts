// Unit tests for clickstack_search's time-budgeted, newest-first window scan.
// ClickhouseClient is mocked to behave like ClickHouse under
// max_execution_time: a "slow" range throws TIMEOUT_EXCEEDED in throw mode and
// returns the rows read so far in break mode.

const mockQueryChartConfig = jest.fn();
const mockGetSource = jest.fn();
const mockGetConnectionById = jest.fn();
const mockDenoise = jest.fn();

jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({
  getSource: (...args: unknown[]) => mockGetSource(...args),
}));
jest.mock('@/controllers/connection', () => ({
  getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
}));
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/mcp/tools/query/denoise', () => ({
  denoiseSearchResults: (...args: unknown[]) => mockDenoise(...args),
}));
jest.mock('@/clickhouse', () => ({
  ClickhouseClient: jest.fn().mockImplementation(() => ({
    queryChartConfig: (...args: unknown[]) => mockQueryChartConfig(...args),
  })),
}));
jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
  ...jest.requireActual('@hyperdx/common-utils/dist/core/metadata'),
  getMetadata: () => ({}),
}));
jest.mock('@/utils/trimToolResponse', () => ({
  SIZE_NOTE_PREFIX: 'size',
  trimToolResponse: (data: unknown) => ({
    data,
    isTrimmed: false,
    notes: [],
  }),
}));

import { ClickHouseError } from '@clickhouse/client-common';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { INVALID_SPAN_CONTEXT, trace } from '@opentelemetry/api';
import mongoose from 'mongoose';

import { registerSearch } from '@/mcp/tools/query/search';
import { SEARCH_TIME_BUDGET_MS } from '@/mcp/tools/query/windowedSearch';
import type { RegisterToolFn, ToolResult } from '@/mcp/tools/types';
import { MCP_TIMEOUT_GRACE_MS } from '@/mcp/utils/timeout';

type Handler = Parameters<RegisterToolFn>[2];
type SearchArgs = {
  sourceId: string;
  startTime?: string;
  endTime?: string;
  denoise?: boolean;
};

const sourceId = new mongoose.Types.ObjectId().toString();
const connectionId = new mongoose.Types.ObjectId().toString();

const logSource = {
  _id: sourceId,
  name: 'Logs',
  kind: SourceKind.Log,
  connection: connectionId,
  timestampValueExpression: 'Timestamp',
  from: { databaseName: 'default', tableName: 'otel_logs' },
};

const END = new Date('2026-11-16T12:00:00.000Z');
const minutesBefore = (m: number) => new Date(END.getTime() - m * 60_000);

type QueryArgs = {
  config: {
    dateRange: [Date, Date];
    limit?: { limit?: number };
    dateRangeEndInclusive?: boolean;
  };
  opts: {
    clickhouse_settings: Record<string, unknown>;
    abort_signal?: AbortSignal;
  };
};

function rowsAt(...minutesAgo: number[]) {
  return minutesAgo.map(m => ({
    Timestamp: minutesBefore(m).toISOString(),
    Body: `log ${m}m ago`,
  }));
}

function chResult(data: Record<string, unknown>[], elapsedSec = 0.05) {
  return {
    meta: [
      { name: 'Timestamp', type: 'DateTime64(9)' },
      { name: 'Body', type: 'String' },
    ],
    data,
    rows: data.length,
    statistics: { elapsed: elapsedSec, rows_read: 1000, bytes_read: 10000 },
  };
}

const timeoutError = () =>
  new ClickHouseError({
    message: 'Timeout exceeded: elapsed 30 seconds (TIMEOUT_EXCEEDED)',
    code: '159',
    type: 'TIMEOUT_EXCEEDED',
  });

/**
 * Data older than 15 minutes is slow to scan: ClickHouse runs out of
 * max_execution_time there, throwing in throw mode and returning what it read
 * so far in break mode.
 */
function slowPastFifteenMinutes({ config, opts }: QueryArgs) {
  const [start] = config.dateRange;
  const settings = opts.clickhouse_settings;
  if (start.getTime() >= minutesBefore(15).getTime()) {
    return Promise.resolve(chResult(rowsAt(1, 5, 10)));
  }
  if (settings.timeout_overflow_mode !== 'break') {
    return Promise.reject(timeoutError());
  }
  return Promise.resolve(
    chResult(rowsAt(30, 90), Number(settings.max_execution_time)),
  );
}

function getHandler() {
  let captured: Handler | undefined;
  const registerTool: RegisterToolFn = (_name, _config, handler) => {
    captured = handler;
  };
  registerSearch({
    server: new McpServer({ name: 'test', version: '0.0.0' }),
    context: { teamId: 'team-1', userId: 'user-1' },
    registerTool,
  });
  if (!captured) throw new Error('handler was not registered');
  // The zod defaults are applied by the MCP server, not the raw handler.
  const registered = captured;
  return (args: SearchArgs) =>
    registered({
      columns: '',
      where: '',
      whereLanguage: 'lucene',
      maxResults: 50,
      denoise: false,
      ...args,
    });
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text);

const queriedRanges = () =>
  mockQueryChartConfig.mock.calls.map(([{ config }]: [QueryArgs]) =>
    config.dateRange.map(d => d.toISOString()),
  );

describe('clickstack_search partial results', () => {
  beforeEach(() => {
    mockGetSource.mockResolvedValue(logSource);
    mockGetConnectionById.mockResolvedValue({
      host: 'http://localhost:8123',
      username: 'default',
      password: '',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('returns the rows found and the covered range when the full window would time out', async () => {
    mockQueryChartConfig.mockImplementation(slowPastFifteenMinutes);

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(24 * 60).toISOString(),
      endTime: END.toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const body = parse(result);
    expect(body.result.data.map((r: { Body: string }) => r.Body)).toEqual([
      'log 1m ago',
      'log 5m ago',
      'log 10m ago',
      'log 30m ago',
      'log 90m ago',
    ]);
    expect(body.partial).toEqual({
      reason: 'time_budget',
      requestedRange: {
        startTime: minutesBefore(24 * 60).toISOString(),
        endTime: END.toISOString(),
      },
      coveredRange: {
        startTime: minutesBefore(15).toISOString(),
        endTime: END.toISOString(),
      },
      incompleteRange: {
        startTime: minutesBefore(15 + 6 * 60).toISOString(),
        endTime: minutesBefore(15).toISOString(),
      },
    });
    expect(body.hints.join(' ')).toContain(
      `endTime=${new Date(minutesBefore(15).getTime() - 1).toISOString()}`,
    );
    expect(body.hints.join(' ')).toContain('may repeat on the next call');
    // Stops at the window that ran out of time instead of scanning older ones.
    expect(queriedRanges()).toEqual([
      [minutesBefore(15).toISOString(), END.toISOString()],
      [
        minutesBefore(15 + 6 * 60).toISOString(),
        minutesBefore(15).toISOString(),
      ],
    ]);
  });

  it('marks the active span when the result is partial', async () => {
    const span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
    const setAttribute = jest.spyOn(span, 'setAttribute');
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
    mockQueryChartConfig.mockImplementation(slowPastFifteenMinutes);

    await getHandler()({
      sourceId,
      startTime: minutesBefore(24 * 60).toISOString(),
      endTime: END.toISOString(),
    });

    expect(setAttribute).toHaveBeenCalledWith('mcp.search.partial', true);
    expect(setAttribute).toHaveBeenCalledWith('mcp.search.windows_scanned', 2);
    expect(setAttribute).toHaveBeenCalledWith(
      'mcp.search.covered_ms',
      15 * 60_000,
    );
  });

  it('asks each window only for the rows still missing, without re-reading boundaries', async () => {
    mockQueryChartConfig.mockImplementation(slowPastFifteenMinutes);

    await getHandler()({
      sourceId,
      startTime: minutesBefore(24 * 60).toISOString(),
      endTime: END.toISOString(),
    });

    const calls = mockQueryChartConfig.mock.calls.map(
      ([{ config }]: [QueryArgs]) => config,
    );
    expect(calls.map(c => c.limit?.limit)).toEqual([50, 47]);
    expect(calls[0].dateRangeEndInclusive).toBeUndefined();
    expect(calls[1].dateRangeEndInclusive).toBe(false);
  });

  it('stops before the next window once the time budget is spent', async () => {
    jest.useFakeTimers({ now: END, doNotFake: ['nextTick', 'queueMicrotask'] });
    mockQueryChartConfig.mockImplementation(({ config }: QueryArgs) => {
      // Finishes just under the cap, leaving too little for another window.
      jest.setSystemTime(Date.now() + SEARCH_TIME_BUDGET_MS - 500);
      const [start] = config.dateRange;
      return Promise.resolve(
        chResult(start >= minutesBefore(15) ? rowsAt(2) : rowsAt(60)),
      );
    });

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(24 * 60).toISOString(),
      endTime: END.toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const body = parse(result);
    expect(body.result.data).toHaveLength(1);
    expect(body.partial.coveredRange).toEqual({
      startTime: minutesBefore(15).toISOString(),
      endTime: END.toISOString(),
    });
    expect(body.partial.incompleteRange).toBeUndefined();
    expect(mockQueryChartConfig).toHaveBeenCalledTimes(1);
  });

  it('flags a result as partial with no covered range when even the newest window runs out of time', async () => {
    mockQueryChartConfig.mockImplementation(({ opts }: QueryArgs) =>
      Promise.resolve(
        chResult(
          rowsAt(3),
          Number(opts.clickhouse_settings.max_execution_time),
        ),
      ),
    );

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(10).toISOString(),
      endTime: END.toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const body = parse(result);
    expect(body.result.data).toHaveLength(1);
    expect(body.partial.coveredRange).toBeNull();
    expect(body.partial.incompleteRange).toEqual({
      startTime: minutesBefore(10).toISOString(),
      endTime: END.toISOString(),
    });
    expect(body.hints.join(' ')).toMatch(/narrow|filter/i);
  });

  it('detects a cut-off window by wall-clock time when ClickHouse reports ~0 elapsed', async () => {
    jest.useFakeTimers({ now: END, doNotFake: ['nextTick', 'queueMicrotask'] });
    mockQueryChartConfig.mockImplementation(({ opts }: QueryArgs) => {
      const capMs = Number(opts.clickhouse_settings.max_execution_time) * 1000;
      jest.setSystemTime(Date.now() + capMs);
      return Promise.resolve(chResult([], 0.00005));
    });

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(10).toISOString(),
      endTime: END.toISOString(),
    });

    const body = parse(result);
    expect(body.partial.coveredRange).toBeNull();
    expect(body.hints.join(' ')).not.toContain('No data found');
  });

  it('returns a fast single-window search unchanged', async () => {
    const chResponse = chResult(rowsAt(1, 2, 3));
    mockQueryChartConfig.mockResolvedValue(chResponse);

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(15).toISOString(),
      endTime: END.toISOString(),
    });

    expect(result.isError).toBeFalsy();
    expect(parse(result)).toEqual({ result: chResponse });
    expect(mockQueryChartConfig).toHaveBeenCalledTimes(1);
  });

  it('stops scanning older windows once the limit is met', async () => {
    mockQueryChartConfig.mockResolvedValue(
      chResult(Array.from({ length: 50 }, (_, i) => rowsAt(i / 10)[0])),
    );

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(7 * 24 * 60).toISOString(),
      endTime: END.toISOString(),
    });

    const body = parse(result);
    expect(body.result.data).toHaveLength(50);
    expect(body.partial).toBeUndefined();
    expect(mockQueryChartConfig).toHaveBeenCalledTimes(1);
  });

  it('scans every window of a sparse range and reports a complete result', async () => {
    mockQueryChartConfig.mockImplementation(({ config }: QueryArgs) => {
      const [start] = config.dateRange;
      return Promise.resolve(
        chResult(start >= minutesBefore(15) ? rowsAt(1) : []),
      );
    });

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(24 * 60).toISOString(),
      endTime: END.toISOString(),
    });

    const body = parse(result);
    expect(body.result.data).toHaveLength(1);
    expect(body.result.rows).toBe(1);
    expect(body.partial).toBeUndefined();
    expect(queriedRanges()[queriedRanges().length - 1][0]).toBe(
      minutesBefore(24 * 60).toISOString(),
    );
  });

  it('keeps the rows already found when an older window fails', async () => {
    mockQueryChartConfig.mockImplementation(({ config }: QueryArgs) => {
      const [start] = config.dateRange;
      return start >= minutesBefore(15)
        ? Promise.resolve(chResult(rowsAt(1)))
        : Promise.reject(timeoutError());
    });

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(24 * 60).toISOString(),
      endTime: END.toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const body = parse(result);
    expect(body.result.data).toHaveLength(1);
    expect(body.partial.reason).toBe('time_budget');
    expect(body.partial.coveredRange.startTime).toBe(
      minutesBefore(15).toISOString(),
    );
    // The failed window returned nothing, so it is not reported as cut off.
    expect(body.partial.incompleteRange).toBeUndefined();
  });

  it('gives up on a stalled window at the backstop and keeps the rows already found', async () => {
    jest.useFakeTimers({ now: END, doNotFake: ['nextTick', 'queueMicrotask'] });
    mockQueryChartConfig.mockImplementation(({ config }: QueryArgs) => {
      const [start] = config.dateRange;
      return start >= minutesBefore(15)
        ? Promise.resolve(chResult(rowsAt(1)))
        : new Promise(() => {});
    });

    const pending = getHandler()({
      sourceId,
      startTime: minutesBefore(24 * 60).toISOString(),
      endTime: END.toISOString(),
    });
    await jest.advanceTimersByTimeAsync(
      SEARCH_TIME_BUDGET_MS + MCP_TIMEOUT_GRACE_MS,
    );
    const body = parse(await pending);

    expect(body.result.data).toHaveLength(1);
    expect(body.partial.reason).toBe('time_budget');
    expect(body.partial.coveredRange.startTime).toBe(
      minutesBefore(15).toISOString(),
    );
    expect(body.partial.incompleteRange).toBeUndefined();
  });

  it('keeps the partial block through denoise and samples only the scanned range', async () => {
    mockQueryChartConfig.mockImplementation(slowPastFifteenMinutes);
    mockDenoise.mockImplementation(
      (_team, _source, _start, _end, rows: unknown[]) =>
        Promise.resolve({ rows, removedPatterns: [] }),
    );

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(24 * 60).toISOString(),
      endTime: END.toISOString(),
      denoise: true,
    });

    const body = parse(result);
    expect(body.denoised.filteredRowCount).toBe(5);
    expect(body.partial.coveredRange.startTime).toBe(
      minutesBefore(15).toISOString(),
    );
    expect(body.hints[0]).toContain('Partial result');
    const [, , denoiseStart, denoiseEnd] = mockDenoise.mock.calls[0];
    expect(denoiseStart).toEqual(minutesBefore(15 + 6 * 60));
    expect(denoiseEnd).toEqual(END);
  });

  it('keeps the rows already found when an older window fails for a reason other than time', async () => {
    mockQueryChartConfig.mockImplementation(({ config }: QueryArgs) => {
      const [start] = config.dateRange;
      return start >= minutesBefore(15)
        ? Promise.resolve(chResult(rowsAt(1)))
        : Promise.reject(
            new Error('Memory limit exceeded (MEMORY_LIMIT_EXCEEDED)'),
          );
    });

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(24 * 60).toISOString(),
      endTime: END.toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const body = parse(result);
    expect(body.result.data).toHaveLength(1);
    expect(body.partial.reason).toBe('query_error');
    expect(body.partial.coveredRange.startTime).toBe(
      minutesBefore(15).toISOString(),
    );
    expect(body.hints[0]).toContain('older window failed');
    expect(body.hints[0]).toContain(
      `endTime=${new Date(minutesBefore(15).getTime() - 1).toISOString()}`,
    );
    expect(body.partial.incompleteRange).toBeUndefined();
    expect(body.hints[0]).not.toContain('may repeat');
  });

  it('returns the error when the newest window fails', async () => {
    mockQueryChartConfig.mockRejectedValue(new Error('Syntax error'));

    const result = await getHandler()({
      sourceId,
      startTime: minutesBefore(10).toISOString(),
      endTime: END.toISOString(),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Syntax error');
  });
});
