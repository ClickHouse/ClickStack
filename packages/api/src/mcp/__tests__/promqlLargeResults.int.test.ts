import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { setupDashboardTests } from '@/mcp/__tests__/dashboards/setup';
import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

const mockFetch = jest.mocked(global.fetch);

const START = 1700000000;
const startTime = new Date(START * 1000).toISOString();
const endTime = new Date((START + 3600) * 1000).toISOString();

// More series than a table tile keeps (10,000), each a few hundred chars, so
// every response is far over MCP's 50,000-char budget before trimming.
const SERIES = 12_000;
const MAX_RESPONSE_CHARS = 50_000;

/** The size the trimmer budgets: the compact `{ result }`, not the printed response. */
const budgetedChars = (text: string) =>
  JSON.stringify({ result: JSON.parse(text).result }).length;

const metric = (i: number) => ({
  __name__: 'smoke_up',
  job: 'checkout',
  instance: `checkout-${i}`,
});

/** A Prometheus that answers every query with SERIES series. */
const answerWithManySeries = () =>
  mockFetch.mockImplementation(async input => {
    const url = new URL(String(input));
    const data = url.pathname.endsWith('/query_range')
      ? {
          resultType: 'matrix',
          result: Array.from({ length: SERIES }, (_, i) => ({
            metric: metric(i),
            values: [[START, '1']],
          })),
        }
      : {
          resultType: 'vector',
          result: Array.from({ length: SERIES }, (_, i) => ({
            metric: metric(i),
            value: [START + 3600, String(i)],
          })),
        };
    return new Response(JSON.stringify({ status: 'success', data }));
  });

describe('MCP PromQL tiles with large results', () => {
  const ctx = setupDashboardTests();

  beforeEach(async () => {
    await ctx.reconnect({ promqlEnabled: true });
    answerWithManySeries();
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  const queryTile = async (config: Record<string, unknown>) => {
    const connection = await Connection.create({
      team: ctx.team._id,
      name: 'Prometheus',
      host: 'http://prom.example.com',
      username: '',
      password: '',
      isPrometheusEndpoint: true,
    });
    const source = await Source.create({
      kind: SourceKind.Promql,
      team: ctx.team._id,
      connection: connection._id,
      name: 'Prometheus',
      from: { databaseName: 'prometheus', tableName: 'prometheus' },
      timestampValueExpression: 'timestamp',
    });
    const saved = await callTool(ctx.client!, 'clickstack_save_dashboard', {
      name: 'Large PromQL results',
      tiles: [
        {
          name: 'Tile',
          config: {
            configType: 'promql',
            sourceId: source._id.toString(),
            ...config,
          },
        },
      ],
    });
    expect(saved.isError ? getFirstText(saved) : '').toBe('');
    const dashboard = JSON.parse(getFirstText(saved));
    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: dashboard.tiles[0].id,
      startTime,
      endTime,
    });
    expect(result.isError ? getFirstText(result) : '').toBe('');
    return getFirstText(result);
  };

  const requestedUrls = () =>
    mockFetch.mock.calls.map(([url]) => new URL(String(url)));

  it('caps an instant table at 10,000 rows, asking Prometheus for no more', async () => {
    const text = await queryTile({
      displayType: 'table',
      expressions: [{ expression: 'smoke_up', queryType: 'instant' }],
    });

    expect(requestedUrls().map(url => url.searchParams.get('limit'))).toEqual([
      '10000',
    ]);
    const response = JSON.parse(text);
    expect(response.result.rows).toBe(10_000);
    expect(response.result.data[0]).toEqual({ ...metric(0), Value: 0 });
    expect(response.note).toContain('trimmed');
    expect(budgetedChars(text)).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });

  it('caps a range table at 10,000 rows', async () => {
    const text = await queryTile({
      displayType: 'table',
      expressions: [{ expression: 'smoke_up' }],
    });

    expect(requestedUrls()[0].searchParams.has('limit')).toBe(false);
    expect(JSON.parse(text).result.rows).toBe(10_000);
    expect(budgetedChars(text)).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });

  // Known bug: line and reduced tiles list every series' labels in
  // seriesLabels, and the trimmer cuts `data` but keeps seriesLabels whole, so
  // the response stays over budget. Turn into `it` once seriesLabels is
  // trimmed along with data.
  it.failing.each(['line', 'number', 'pie', 'bar'])(
    'trims a %s tile with many series to the response budget',
    async displayType => {
      const text = await queryTile({
        displayType,
        expressions: [
          {
            expression: 'smoke_up',
            ...(displayType === 'line' ? {} : { queryType: 'instant' }),
          },
        ],
      });

      expect(budgetedChars(text)).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    },
  );
});
