import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  clearBackendProbeCache,
  CLICKHOUSE_PROMETHEUS_API_PREFIX,
  PROMETHEUS_MAX_RESPONSE_BYTES,
} from '@/controllers/promql';
import {
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  getLoggedInAgent,
  getServer,
  seedTimeSeriesTagsTable,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

const mockFetch = jest.mocked(global.fetch);
const { realFetch } = globalThis as unknown as { realFetch: typeof fetch };

const TABLE = 'mcp_promql_sources';

const prometheusResponse = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify({ status: 'success', data }), init);

describe('MCP PromQL sources', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let promqlSource: any;
  let client: Client;

  const connect = async (promqlEnabled: boolean) => {
    client = await createTestClient({
      teamId: team._id.toString(),
      userId: user._id.toString(),
      promqlEnabled,
    });
  };

  const createPrometheusSource = async () => {
    const connection = await Connection.create({
      team: team._id,
      name: 'Prometheus',
      host: 'http://user:secret@prom.example.com',
      username: '',
      password: '',
      isPrometheusEndpoint: true,
    });
    return Source.create({
      kind: SourceKind.Promql,
      team: team._id,
      connection: connection._id,
      name: 'Prometheus metrics',
      from: { databaseName: 'prometheus', tableName: 'prometheus' },
      timestampValueExpression: 'timestamp',
    });
  };

  beforeAll(async () => {
    await server.start();
    const nowSec = Math.floor(Date.now() / 1000);
    await seedTimeSeriesTagsTable({
      table: TABLE,
      series: [
        {
          metricName: 'http_requests_total',
          tags: { job: 'checkout', instance: 'checkout-0' },
          startSec: nowSec - 600,
          endSec: nowSec - 60,
        },
        {
          metricName: 'up',
          tags: { job: 'cart' },
          startSec: nowSec - 600,
          endSec: nowSec - 60,
        },
      ],
      withSamples: true,
    });
  });

  beforeEach(async () => {
    ({ team, user } = await getLoggedInAgent(server));
    const connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    // Pinned so these tests read labels with SQL on any server version; the
    // HTTP API path is covered on its own below.
    promqlSource = await Source.create({
      kind: SourceKind.Promql,
      team: team._id,
      connection: connection._id,
      name: 'TimeSeries metrics',
      from: { databaseName: DEFAULT_DATABASE, tableName: TABLE },
      timestampValueExpression: 'timestamp',
      promqlBackend: 'table-function',
    });
  });

  afterEach(async () => {
    await client?.close();
    await server.clearDBs();
    clearBackendProbeCache();
    mockFetch.mockReset();
  });

  afterAll(async () => {
    await dropTimeSeriesTable({ table: TABLE });
    await server.stop();
  });

  describe('with PromQL enabled', () => {
    beforeEach(() => connect(true));

    it('lists a TimeSeries source with its table, with usage guidance', async () => {
      const result = await callTool(client, 'clickstack_list_sources');

      const output = JSON.parse(getFirstText(result));
      expect(output.sources).toHaveLength(1);
      expect(output.sources[0]).toMatchObject({
        id: promqlSource._id.toString(),
        kind: SourceKind.Promql,
        backend: 'clickhouse',
        table: `${DEFAULT_DATABASE}.${TABLE}`,
      });
      expect(output.promqlUsage).toContain('timeSeriesData');
    });

    it('lists a Prometheus endpoint source without its placeholder table', async () => {
      const source = await createPrometheusSource();

      const result = await callTool(client, 'clickstack_list_sources');

      const output = JSON.parse(getFirstText(result));
      const listed = output.sources.find(
        (s: any) => s.id === source._id.toString(),
      );
      expect(listed.backend).toBe('prometheus');
      expect(listed.table).toBeUndefined();
      expect(listed.database).toBeUndefined();
    });

    it('reads a TimeSeries table through clickstack_sql as the hint describes', async () => {
      const table = `${DEFAULT_DATABASE}.${TABLE}`;
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: promqlSource.connection.toString(),
        sql:
          `SELECT t.metric_name AS metric, count() AS samples ` +
          `FROM timeSeriesData(${table}) AS d ` +
          `INNER JOIN timeSeriesTags(${table}) AS t ON d.id = t.id ` +
          `GROUP BY metric ORDER BY metric`,
      });

      expect(result.isError).toBeFalsy();
      const text = getFirstText(result);
      expect(text).toContain('http_requests_total');
      expect(text).toContain('up');
    });

    it('describes a TimeSeries table by its label names and metric names', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: promqlSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.source).toMatchObject({
        id: promqlSource._id.toString(),
        kind: SourceKind.Promql,
        backend: 'clickhouse',
        table: `${DEFAULT_DATABASE}.${TABLE}`,
      });
      expect(output.labelNames).toEqual(['__name__', 'instance', 'job']);
      expect(output.metricNames).toEqual(['http_requests_total', 'up']);
      expect(output.columns).toBeUndefined();
      expect(output.nextSteps.sql).toContain(
        `timeSeriesData(${DEFAULT_DATABASE}.${TABLE})`,
      );
    });

    it('describes a Prometheus endpoint source through its label API', async () => {
      const source = await createPrometheusSource();
      mockFetch.mockImplementation(async input =>
        prometheusResponse(
          String(input).includes('/label/__name__/values')
            ? ['up']
            : ['__name__', 'job'],
        ),
      );

      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: source._id.toString(),
      });

      const output = JSON.parse(getFirstText(result));
      expect(output.source.backend).toBe('prometheus');
      expect(output.source.table).toBeUndefined();
      expect(output.nextSteps.sql).toBeUndefined();
      expect(output.labelNames).toEqual(['__name__', 'job']);
      expect(output.metricNames).toEqual(['up']);
      const urls = mockFetch.mock.calls.map(
        ([input]) => new URL(String(input)),
      );
      expect(urls.map(u => u.pathname).sort()).toEqual([
        '/api/v1/label/__name__/values',
        '/api/v1/labels',
      ]);
      expect(urls[0].searchParams.get('start')).toBeTruthy();
      // fetch rejects a URL with credentials, so they travel as a header.
      for (const [input, init] of mockFetch.mock.calls) {
        expect(new URL(String(input)).username).toBe('');
        expect(init?.headers).toEqual({
          Authorization: `Basic ${Buffer.from('user:secret').toString('base64')}`,
        });
      }
    });

    it('still returns the source config when the label lookup fails', async () => {
      const source = await createPrometheusSource();
      mockFetch.mockRejectedValue(new Error('fetch failed'));

      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: source._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.source.config).toMatchObject({ kind: SourceKind.Promql });
      expect(output.partial).toBe(true);
      expect(output.error).toContain('http://prom.example.com/api/v1/');
      expect(output.error).not.toContain('secret');
    });

    it('still returns the source config when a label list is too large to buffer', async () => {
      const source = await createPrometheusSource();
      mockFetch.mockImplementation(async () =>
        prometheusResponse(['up'], {
          headers: {
            'content-length': String(PROMETHEUS_MAX_RESPONSE_BYTES + 1),
          },
        }),
      );

      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: source._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.partial).toBe(true);
      expect(output.error).toContain('returned more than 8 MB');
    });

    describe("through ClickHouse's prometheus_api_v1 handler", () => {
      let autoSource: any;
      let versionSpy: jest.SpyInstance | undefined;

      const stubServerVersion = (version: [number, number, number, number]) => {
        versionSpy = jest
          .spyOn(Metadata.prototype, 'getServerVersion')
          .mockResolvedValue(version);
      };

      const describeAutoSource = async () => {
        const result = await callTool(client, 'clickstack_describe_source', {
          sourceId: autoSource._id.toString(),
        });
        expect(result.isError).toBeFalsy();
        return JSON.parse(getFirstText(result));
      };

      const labelLookupUrls = () =>
        mockFetch.mock.calls
          .map(([input]) => new URL(String(input)))
          .filter(
            url =>
              url.pathname !==
              `${CLICKHOUSE_PROMETHEUS_API_PREFIX}/format_query`,
          );

      beforeEach(async () => {
        autoSource = await Source.create({
          kind: SourceKind.Promql,
          team: team._id,
          connection: promqlSource.connection,
          name: 'TimeSeries metrics (auto)',
          from: { databaseName: DEFAULT_DATABASE, tableName: TABLE },
          timestampValueExpression: 'timestamp',
        });
      });

      afterEach(() => {
        versionSpy?.mockRestore();
        versionSpy = undefined;
      });

      it("sends the label lookups with the source's table and the connection's credentials", async () => {
        stubServerVersion([26, 10, 0, 0]);
        mockFetch.mockImplementation(async input => {
          const { pathname } = new URL(String(input));
          if (pathname.endsWith('/format_query')) {
            return prometheusResponse('up');
          }
          return prometheusResponse(
            pathname.endsWith('/label/__name__/values')
              ? ['up']
              : ['__name__', 'job'],
          );
        });

        const output = await describeAutoSource();

        expect(output.source).toMatchObject({
          backend: 'clickhouse',
          table: `${DEFAULT_DATABASE}.${TABLE}`,
        });
        expect(output.labelNames).toEqual(['__name__', 'job']);
        expect(output.metricNames).toEqual(['up']);
        const urls = labelLookupUrls();
        expect(urls.map(u => u.pathname).sort()).toEqual([
          `${CLICKHOUSE_PROMETHEUS_API_PREFIX}/label/__name__/values`,
          `${CLICKHOUSE_PROMETHEUS_API_PREFIX}/labels`,
        ]);
        for (const url of urls) {
          expect(url.searchParams.getAll('database')).toEqual([
            DEFAULT_DATABASE,
          ]);
          expect(url.searchParams.getAll('table')).toEqual([TABLE]);
          expect(url.searchParams.get('start')).toBeTruthy();
          expect(url.searchParams.get('end')).toBeTruthy();
          expect(url.searchParams.get('limit')).toBe('201');
        }
        for (const [input, init] of mockFetch.mock.calls) {
          if (new URL(String(input)).pathname.endsWith('/format_query')) {
            continue;
          }
          expect(init?.headers).toMatchObject({
            'X-ClickHouse-User': config.CLICKHOUSE_USER,
            'X-ClickHouse-Key': config.CLICKHOUSE_PASSWORD,
            'X-ClickHouse-Query-Id': expect.stringMatching(/^hdx-mcp-/),
          });
        }
      });

      // 26.8's handler answers label lookups with a 400 ("not implemented").
      it('reads labels with SQL on ClickHouse 26.8, whose handler serves only queries', async () => {
        stubServerVersion([26, 8, 36, 3]);
        mockFetch.mockImplementation(async () => prometheusResponse('up'));

        const output = await describeAutoSource();

        expect(output.labelNames).toEqual(['__name__', 'instance', 'job']);
        expect(output.metricNames).toEqual(['http_requests_total', 'up']);
        expect(labelLookupUrls()).toEqual([]);
      });

      // Needs ClickHouse 26.9+, whose handler serves label lookups.
      it('lists labels from the CI ClickHouse handler', async () => {
        mockFetch.mockImplementation(realFetch);

        const output = await describeAutoSource();

        expect(output.labelNames).toEqual(['__name__', 'instance', 'job']);
        expect(output.metricNames).toEqual(['http_requests_total', 'up']);
        expect(
          labelLookupUrls()
            .map(u => u.pathname)
            .sort(),
        ).toEqual([
          `${CLICKHOUSE_PROMETHEUS_API_PREFIX}/label/__name__/values`,
          `${CLICKHOUSE_PROMETHEUS_API_PREFIX}/labels`,
        ]);
      });
    });

    it('keeps promqlBackend through a describe -> rename -> save round trip', async () => {
      const pinned = await Source.create({
        kind: SourceKind.Promql,
        team: team._id,
        connection: promqlSource.connection,
        name: 'Rename Me',
        from: { databaseName: DEFAULT_DATABASE, tableName: TABLE },
        timestampValueExpression: 'timestamp',
        promqlBackend: 'clickhouse-http',
      });

      const described = await callTool(client, 'clickstack_describe_source', {
        sourceId: pinned._id.toString(),
      });
      const sourceConfig = JSON.parse(getFirstText(described)).source.config;
      expect(sourceConfig.promqlBackend).toBe('clickhouse-http');

      const result = await callTool(client, 'clickstack_save_source', {
        ...sourceConfig,
        id: pinned._id.toString(),
        name: 'Renamed',
      });
      expect(result.isError).toBeFalsy();

      const stored = await Source.findById(pinned._id);
      expect(stored?.name).toBe('Renamed');
      expect(stored?.get('promqlBackend')).toBe('clickhouse-http');
    });

    it('sets promqlBackend when saving a new PromQL source', async () => {
      const result = await callTool(client, 'clickstack_save_source', {
        kind: 'promql',
        name: 'Pinned PromQL',
        connection: promqlSource.connection.toString(),
        databaseName: DEFAULT_DATABASE,
        tableName: TABLE,
        timestampValueExpression: 'timestamp',
        promqlBackend: 'table-function',
      });

      expect(result.isError).toBeFalsy();
      const stored = await Source.findOne({ name: 'Pinned PromQL' });
      expect(stored?.get('promqlBackend')).toBe('table-function');
    });

    it('rejects a promqlBackend that is not one of the known backends', async () => {
      const result = await callTool(client, 'clickstack_save_source', {
        kind: 'promql',
        name: 'Bad PromQL',
        connection: promqlSource.connection.toString(),
        databaseName: DEFAULT_DATABASE,
        tableName: TABLE,
        timestampValueExpression: 'timestamp',
        promqlBackend: 'http',
      });

      expect(result.isError).toBe(true);
      expect(await Source.findOne({ name: 'Bad PromQL' })).toBeNull();
    });
  });

  describe('with PromQL disabled', () => {
    beforeEach(() => connect(false));

    it('hides PromQL sources from clickstack_list_sources', async () => {
      const result = await callTool(client, 'clickstack_list_sources');

      const output = JSON.parse(getFirstText(result));
      expect(output.sources).toEqual([]);
      expect(output.promqlUsage).toBeUndefined();
    });

    it('treats a PromQL source as not found in clickstack_describe_source', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: promqlSource._id.toString(),
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });

    it('treats a PromQL source as not found in clickstack_delete_source', async () => {
      const result = await callTool(client, 'clickstack_delete_source', {
        id: promqlSource._id.toString(),
      });

      expect(result.isError).toBe(true);
      expect(await Source.findById(promqlSource._id)).not.toBeNull();
    });

    it('rejects kind promql in clickstack_save_source', async () => {
      const result = await callTool(client, 'clickstack_save_source', {
        kind: 'promql',
        name: 'New PromQL',
        connection: promqlSource.connection.toString(),
        databaseName: DEFAULT_DATABASE,
        tableName: TABLE,
        timestampValueExpression: 'timestamp',
      });

      expect(result.isError).toBe(true);
      expect(await Source.countDocuments({ name: 'New PromQL' })).toBe(0);
    });
  });
});
