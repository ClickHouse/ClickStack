import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  seedTimeSeriesTagsTable,
  TimeSeriesFixtureSeries,
} from '@/fixtures';
import { setupDashboardTests } from '@/mcp/__tests__/dashboards/setup';
import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

const mockFetch = jest.mocked(global.fetch);
// Set by jest.setup.ts before it stubs `fetch`.
const realFetch: typeof fetch = globalThis.realFetch;

// The CI Prometheus remote-reads this table from ClickHouse (see
// docker/prometheus/prometheus.ci.yml), so every backend reads the same samples.
const TABLE = 'metrics_ts';
const PROMETHEUS_URL = process.env.CI_PROMETHEUS_URL ?? '';

const START = 1700000000;
const STEP = 15;
const SAMPLES = 121; // 30 minutes

const series = (
  metricName: string,
  tags: Record<string, string>,
  value: (i: number) => number,
): TimeSeriesFixtureSeries => ({
  metricName,
  tags,
  startSec: START,
  endSec: START + (SAMPLES - 1) * STEP,
  samples: Array.from({ length: SAMPLES }, (_, i) => [
    START + i * STEP,
    value(i),
  ]),
});

const SERIES = [
  series('smoke_requests_total', { job: 'checkout', instance: 'c-0' }, i => i),
  series(
    'smoke_requests_total',
    { job: 'checkout', instance: 'c-1' },
    i => 2 * i,
  ),
  series('smoke_requests_total', { job: 'cart', instance: 'k-0' }, i => 3 * i),
  series('smoke_queue_depth', { job: 'checkout' }, i => i % 10),
  ...(
    [
      ['0.1', 1],
      ['1', 3],
      ['+Inf', 4],
    ] as const
  ).map(([le, perSample]) =>
    series(
      'smoke_latency_seconds_bucket',
      { job: 'checkout', le },
      i => perSample * i,
    ),
  ),
];

// Off the minute, and inside the data once aligned to the granularity.
const startTime = new Date((START + 307) * 1000).toISOString();
const endTime = new Date((START + 1500) * 1000).toISOString();

const RATE = 'rate(smoke_requests_total[1m])';

/** Tiles in clickstack_save_dashboard's shape, without sourceId. */
const TILES: { name: string; config: Record<string, unknown> }[] = [
  {
    name: 'line by instance',
    config: {
      displayType: 'line',
      expressions: [{ expression: `sum by (instance) (${RATE})` }],
      legendTemplate: '{{instance}}',
    },
  },
  {
    name: 'line with two expressions',
    config: {
      displayType: 'line',
      expressions: [
        { expression: `sum by (job) (${RATE})` },
        { expression: `sum(${RATE})`, alias: 'Total' },
      ],
      legendTemplate: '{{job}}',
    },
  },
  {
    name: 'line, unaligned',
    config: {
      displayType: 'line',
      expressions: [{ expression: 'smoke_queue_depth' }],
      granularity: '1 minute',
      alignDateRangeToGranularity: false,
    },
  },
  {
    name: 'stacked bar',
    config: {
      displayType: 'stacked_bar',
      expressions: [{ expression: `sum by (job) (${RATE})` }],
      legendTemplate: '{{job}}',
    },
  },
  ...(['max', 'min', 'mean', undefined] as const).map(reducer => ({
    name: `number, ${reducer ?? 'default'} reducer`,
    config: {
      displayType: 'number',
      expressions: [{ expression: 'sum(smoke_queue_depth)', reducer }],
    },
  })),
  {
    name: 'number, instant',
    config: {
      displayType: 'number',
      expressions: [
        { expression: 'count(smoke_requests_total)', queryType: 'instant' },
      ],
    },
  },
  {
    name: 'pie by job',
    config: {
      displayType: 'pie',
      expressions: [{ expression: `sum by (job) (${RATE})` }],
      legendTemplate: '{{job}}',
    },
  },
  {
    name: 'bar by instance, instant',
    config: {
      displayType: 'bar',
      expressions: [
        { expression: 'smoke_requests_total', queryType: 'instant' },
      ],
      legendTemplate: '{{instance}}',
    },
  },
  {
    name: 'table, range',
    config: {
      displayType: 'table',
      expressions: [{ expression: 'smoke_queue_depth' }],
      granularity: '5 minute',
    },
  },
  {
    name: 'table, instant',
    config: {
      displayType: 'table',
      expressions: [
        { expression: 'smoke_requests_total', queryType: 'instant' },
      ],
    },
  },
  {
    name: 'histogram heatmap',
    config: {
      displayType: 'heatmap',
      heatmapMode: 'histogram',
      expressions: [
        {
          expression:
            'sum by (le) (rate(smoke_latency_seconds_bucket[$__rate_interval]))',
        },
      ],
    },
  },
];

type Backend = 'prometheus' | 'clickhouse-http' | 'table-function';
const BACKENDS: Backend[] = ['prometheus', 'clickhouse-http', 'table-function'];

describe('MCP PromQL on every backend', () => {
  const ctx = setupDashboardTests();

  beforeAll(async () => {
    expect(PROMETHEUS_URL).not.toBe('');
    await seedTimeSeriesTagsTable({
      table: TABLE,
      series: SERIES,
      withSamples: true,
    });
  });

  afterAll(async () => {
    await dropTimeSeriesTable({ table: TABLE });
  });

  beforeEach(async () => {
    await ctx.reconnect({ promqlEnabled: true });
    mockFetch.mockImplementation(realFetch);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockFetch.mockReset();
  });

  const createSource = async (backend: Backend) => {
    const connection =
      backend === 'prometheus'
        ? await Connection.create({
            team: ctx.team._id,
            name: 'Prometheus',
            host: PROMETHEUS_URL,
            username: '',
            password: '',
            isPrometheusEndpoint: true,
          })
        : ctx.connection;
    const source = await Source.create({
      kind: SourceKind.Promql,
      team: ctx.team._id,
      connection: connection._id,
      name: backend,
      from: { databaseName: DEFAULT_DATABASE, tableName: TABLE },
      timestampValueExpression: 'timestamp',
    });
    return source._id.toString();
  };

  /**
   * Runs `run` against one backend, and checks its PromQL queries went there.
   * ClickHouse before 26.6 has no Prometheus HTTP API, so MCP uses the table
   * function.
   */
  const onBackend = async <T>(backend: Backend, run: () => Promise<T>) => {
    const spy =
      backend === 'table-function'
        ? jest
            .spyOn(Metadata.prototype, 'getServerVersion')
            .mockResolvedValue([26, 5, 0, 0])
        : undefined;
    const callsBefore = mockFetch.mock.calls.length;
    try {
      return await run();
    } finally {
      spy?.mockRestore();
      const queried = mockFetch.mock.calls
        .slice(callsBefore)
        .map(([url]) => String(url))
        .filter(url => /\/api\/v1\/query(_range)?\?/.test(url));
      const expected = {
        prometheus: `${PROMETHEUS_URL}/api/v1/query`,
        'clickhouse-http': '/prometheus/api/v1/query',
        'table-function': undefined,
      }[backend];
      if (expected) {
        expect(queried.length).toBeGreaterThan(0);
        for (const url of queried) expect(url).toContain(expected);
      } else {
        expect(queried).toEqual([]);
      }
    }
  };

  /** In sequence: the table-function backend patches a shared prototype. */
  const onEveryBackend = async <T>(run: (backend: Backend) => Promise<T>) => {
    const results: T[] = [];
    for (const backend of BACKENDS) results.push(await run(backend));
    return results;
  };

  const call = async (tool: string, args: Record<string, unknown>) => {
    const result = await callTool(ctx.client!, tool, args);
    const text = getFirstText(result);
    if (result.isError) throw new Error(`${tool} failed: ${text}`);
    return JSON.parse(text);
  };

  /** Saves TILES on one backend's source and returns each tile's result, by name. */
  const queryTiles = async (backend: Backend) => {
    const sourceId = await createSource(backend);
    const dashboard = await call('clickstack_save_dashboard', {
      name: `PromQL on ${backend}`,
      tiles: TILES.map(({ name, config }) => ({
        name,
        config: { configType: 'promql', sourceId, ...config },
      })),
    });
    const results: Record<string, unknown> = {};
    for (const tile of dashboard.tiles) {
      results[tile.name] = await onBackend(backend, async () => {
        const { result } = await call('clickstack_query_tile', {
          dashboardId: dashboard.id,
          tileId: tile.id,
          startTime,
          endTime,
        });
        return result;
      });
    }
    return results;
  };

  it('returns the same tile results from every backend', async () => {
    const [prometheus, ...clickhouse] = await onEveryBackend(queryTiles);

    for (const name of TILES.map(t => t.name)) {
      expect(prometheus[name]).toMatchObject({ rows: expect.any(Number) });
      for (const other of clickhouse) {
        expect({ name, result: other[name] }).toEqual({
          name,
          result: prometheus[name],
        });
      }
    }
  });

  it('returns the expected values', async () => {
    const results = await queryTiles('prometheus');
    const rows = (name: string) =>
      (results[name] as { data: Record<string, unknown>[] }).data;

    // c-0 counts 1 per 15s sample, c-1 2 and k-0 3.
    const c0 = rows('line by instance').find(
      row =>
        row.series_name === 'c-0' &&
        row.__hdx_time_bucket === '2023-11-14T22:20:00.000Z',
    );
    expect(c0?.value).toBeCloseTo(1 / 15);
    expect(rows('number, max reducer')).toEqual([
      { series_name: 'sum(smoke_queue_depth)', value: 9 },
    ]);
    expect(rows('number, min reducer')).toEqual([
      { series_name: 'sum(smoke_queue_depth)', value: 0 },
    ]);
    expect(rows('number, instant')).toEqual([
      { series_name: 'count(smoke_requests_total)', value: 3 },
    ]);
    expect(rows('table, instant')).toContainEqual({
      __name__: 'smoke_requests_total',
      instance: 'k-0',
      job: 'cart',
      Value: 300,
    });
    expect(new Set(rows('histogram heatmap').map(row => row.le))).toEqual(
      new Set(['0.1', '1', '+Inf']),
    );
  });

  it('returns the same clickstack_promql results from every backend', async () => {
    const run = (backend: Backend) =>
      onBackend(backend, async () => {
        const sourceId = await createSource(backend);
        const args = { sourceId, startTime, endTime };
        return {
          range: await call('clickstack_promql', {
            ...args,
            expression: `sum by (job) (${RATE})`,
          }),
          instant: await call('clickstack_promql', {
            ...args,
            expression: 'smoke_queue_depth',
            queryType: 'instant',
          }),
        };
      });

    const [prometheus, ...clickhouse] = await onEveryBackend(run);

    expect(prometheus.range.result.data.length).toBeGreaterThan(0);
    expect(prometheus.instant.result.data).toEqual([
      { __name__: 'smoke_queue_depth', job: 'checkout', Value: 0 },
    ]);
    for (const other of clickhouse) expect(other).toEqual(prometheus);
  });

  it('applies a dashboard variable on every backend', async () => {
    const run = async (backend: Backend) => {
      const sourceId = await createSource(backend);
      const dashboard = await call('clickstack_save_dashboard', {
        name: `Variables on ${backend}`,
        tiles: [
          {
            name: 'by instance',
            config: {
              configType: 'promql',
              displayType: 'line',
              sourceId,
              expressions: [
                {
                  expression: `sum by (instance) (rate(smoke_requests_total{job=~"$job"}[1m]))`,
                },
              ],
              legendTemplate: '{{instance}}',
            },
          },
        ],
        filters: [
          {
            type: 'PROMETHEUS_LABEL',
            name: 'Job',
            sourceId,
            label: 'job',
            variableName: 'job',
          },
        ],
      });
      return onBackend(backend, () =>
        call('clickstack_query_tile', {
          dashboardId: dashboard.id,
          tileId: dashboard.tiles[0].id,
          startTime,
          endTime,
          variableValues: [{ name: 'job', values: ['checkout'] }],
        }),
      );
    };

    const [prometheus, ...clickhouse] = await onEveryBackend(run);

    expect(Object.keys(prometheus.result.seriesLabels).sort()).toEqual([
      'c-0',
      'c-1',
    ]);
    for (const other of clickhouse) expect(other).toEqual(prometheus);
  });
});
