import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { isRawSqlChartConfig } from '@hyperdx/common-utils/dist/guards';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  bulkInsertLogs,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { LogSource, Source, SourceDocument } from '@/models/source';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('log body fallback for bare-text MCP filters', () => {
  const server = getServer();
  let client: Client;
  let source: SourceDocument;
  let connectionId: string;
  let now: number;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const { team, user } = await getLoggedInAgent(server);
    const connection = await Connection.create({
      team: team._id,
      name: 'Body fallback',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    connectionId = connection.id;
    source = await Source.create({
      kind: SourceKind.Log,
      team: team._id,
      connection: connection._id,
      name: 'Logs',
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
      timestampValueExpression: 'Timestamp',
      bodyExpression: 'Body',
    });
    client = await createTestClient({
      teamId: team._id.toString(),
      userId: user._id.toString(),
    });
    now = Date.now();
    await bulkInsertLogs(
      [2, 7].flatMap(minutes => [
        {
          Body: 'needle in body',
          ServiceName: 'api',
          SeverityText: 'error',
          LogAttributes: { message: 'other' },
          Timestamp: new Date(now - minutes * 60_000),
        },
        {
          Body: 'other',
          ServiceName: 'needle',
          SeverityText: 'info',
          LogAttributes: { message: 'needle in map' },
          Timestamp: new Date(now - minutes * 60_000),
        },
      ]),
    );
  });

  afterEach(async () => {
    await client.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  const currentWindow = () => ({
    startTime: new Date(now - 5 * 60_000).toISOString(),
    endTime: new Date(now).toISOString(),
  });

  it.each([
    { implicitColumnExpression: undefined, expectedBody: 'needle in body' },
    { implicitColumnExpression: '', expectedBody: 'needle in body' },
    { implicitColumnExpression: 'ServiceName', expectedBody: 'other' },
  ])(
    'searches the correct field with implicitColumnExpression=$implicitColumnExpression',
    async ({ implicitColumnExpression, expectedBody }) => {
      await LogSource.updateOne(
        { _id: source._id },
        implicitColumnExpression === undefined
          ? { $unset: { implicitColumnExpression: '' } }
          : { $set: { implicitColumnExpression } },
      );
      const result = await callTool(client, 'clickstack_search', {
        sourceId: source._id.toString(),
        where: 'needle',
        ...currentWindow(),
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.result.data).toEqual([
        expect.objectContaining({ Body: expectedBody }),
      ]);
    },
  );

  it('uses a map-valued body expression for bare-text search', async () => {
    await LogSource.updateOne(
      { _id: source._id },
      { $set: { bodyExpression: "LogAttributes['message']" } },
    );
    const result = await callTool(client, 'clickstack_search', {
      sourceId: source._id.toString(),
      where: 'needle',
      ...currentWindow(),
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(getFirstText(result)).result.data).toEqual([
      expect.objectContaining({ Body: 'other' }),
    ]);
  });

  it('rejects bare-text search without an implicit column or body expression', async () => {
    await LogSource.updateOne(
      { _id: source._id },
      { $unset: { implicitColumnExpression: '', bodyExpression: '' } },
    );
    const result = await callTool(client, 'clickstack_search', {
      sourceId: source._id.toString(),
      where: 'needle',
      ...currentWindow(),
    });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain(
      'Can not search bare text without an implicit column set.',
    );
  });

  it('does not introduce a body fallback for MCP trace searches', async () => {
    const traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: source.team,
      connection: source.connection,
      name: 'Traces',
      from: { databaseName: 'default', tableName: 'otel_traces' },
      timestampValueExpression: 'Timestamp',
      spanNameExpression: 'SpanName',
    });
    const result = await callTool(client, 'clickstack_search', {
      sourceId: traceSource._id.toString(),
      where: 'needle',
      ...currentWindow(),
    });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain(
      'Can not search bare text without an implicit column set.',
    );
  });

  it('uses raw SQL tile hydration to filter by the log body expression', async () => {
    const saved = await callTool(client, 'clickstack_save_dashboard', {
      name: 'Body fallback',
      tiles: [
        {
          name: 'Matching logs',
          config: {
            configType: 'sql',
            displayType: 'table',
            connectionId,
            sourceId: source._id.toString(),
            sqlTemplate:
              'SELECT Body FROM $__sourceTable WHERE $__timeFilter(Timestamp) AND $__filters',
          },
        },
      ],
    });
    expect(saved.isError).toBeFalsy();
    const dashboard = JSON.parse(getFirstText(saved));
    const query = jest.spyOn(ClickhouseClient.prototype, 'queryChartConfig');
    try {
      const result = await callTool(client, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        ...currentWindow(),
      });
      expect(result.isError).toBeFalsy();
      expect(query).toHaveBeenCalledTimes(1);
      const [queryOptions] = query.mock.calls[0];
      if (!isRawSqlChartConfig(queryOptions.config)) {
        throw new Error('Expected a raw SQL tile query');
      }
      const clickhouseClient = new ClickhouseClient({
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });
      // query_tile exposes variables but not runtime dashboard filters.
      const filtered = await clickhouseClient.queryChartConfig({
        ...queryOptions,
        config: {
          ...queryOptions.config,
          filters: [{ type: 'lucene', condition: 'needle' }],
        },
      });
      expect(filtered.data).toEqual([{ Body: 'needle in body' }]);
    } finally {
      query.mockRestore();
    }
  });

  it('uses the fallback for pattern samples, counts and drill-down filters', async () => {
    const result = await callTool(client, 'clickstack_event_patterns', {
      sourceId: source._id.toString(),
      where: 'needle',
      ...currentWindow(),
    });
    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.summary.totalCount).toBe(1);
    expect(output.summary.sampledCount).toBe(1);
    expect(output.patterns).toHaveLength(1);
    expect(output.patterns[0].whereSnippet).toContain('Body');
    const drilldown = await callTool(client, 'clickstack_search', {
      sourceId: source._id.toString(),
      where: output.patterns[0].whereSnippet,
      whereLanguage: 'sql',
      ...currentWindow(),
    });
    expect(drilldown.isError).toBeFalsy();
    expect(JSON.parse(getFirstText(drilldown)).result.data).toEqual([
      expect.objectContaining({ Body: 'needle in body' }),
    ]);
  });

  it('uses the fallback in both emerging-signals windows', async () => {
    const result = await callTool(client, 'clickstack_emerging_signals', {
      sourceId: source._id.toString(),
      where: 'needle',
      currentStartTime: currentWindow().startTime,
      currentEndTime: currentWindow().endTime,
      baselineStartTime: new Date(now - 10 * 60_000).toISOString(),
      baselineEndTime: currentWindow().startTime,
    });
    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.summary.currentWindow.total).toBe(1);
    expect(output.summary.currentWindow.sampled).toBe(1);
    expect(output.summary.baselineWindow.total).toBe(1);
    expect(output.summary.baselineWindow.sampled).toBe(1);
  });

  it('uses the fallback in both event-deltas samples', async () => {
    const result = await callTool(client, 'clickstack_event_deltas', {
      sourceId: source._id.toString(),
      target: { ...currentWindow(), where: 'needle' },
      baseline: {
        startTime: new Date(now - 10 * 60_000).toISOString(),
        endTime: currentWindow().startTime,
        where: 'needle',
      },
    });
    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.summary.targetSampleCount).toBe(1);
    expect(output.summary.baselineSampleCount).toBe(1);
  });
});
