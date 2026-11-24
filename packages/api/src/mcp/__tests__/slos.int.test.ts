import { SourceKind } from '@hyperdx/common-utils/dist/types';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import mongoose from 'mongoose';

import * as config from '@/config';
import {
  bulkInsertData,
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import type { McpContext } from '@/mcp/tools/types';
import Alert, { AlertSource } from '@/models/alert';
import Connection from '@/models/connection';
import Slo from '@/models/slo';
import { Source } from '@/models/source';
import Webhook from '@/models/webhook';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

// ClickHouse is shared across tests and files, so scope the spans to this run.
const SERVICE = `mcp-slo-${Date.now()}`;

describe('MCP SLO write tools', () => {
  const server = getServer();
  let client: Client;
  let teamId: string;
  let sourceId: string;
  let webhookId: string;
  let slosEnabled: jest.ReplaceProperty<boolean>;

  const definition = (overrides: Record<string, unknown> = {}) => ({
    name: 'Checkout availability',
    source: sourceId,
    indicator: {
      template: 'availability',
      eligible: {
        where: `startsWith(ServiceName, '${SERVICE}-')`,
        whereLanguage: 'sql',
      },
      good: "StatusCode != 'Error'",
    },
    target: 99,
    window: '7d',
    ...overrides,
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await callTool(client, name, args);
    return { isError: result.isError, text: getFirstText(result) };
  };

  beforeAll(async () => {
    await server.start();
    const now = Date.now();
    // One service with every span good, one with a fifth of them bad.
    await bulkInsertData(
      `${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
      [`${SERVICE}-a`, `${SERVICE}-b`].flatMap((service, s) =>
        Array.from({ length: 50 }, (_, i) => ({
          Timestamp: new Date(now - (i + 1) * 60_000),
          TraceId: `${service}-trace-${i}`,
          SpanId: `${service}-span-${i}`,
          ParentSpanId: '',
          SpanName: 'POST /checkout',
          SpanKind: 'Server',
          ServiceName: service,
          Duration: 100 * 1e6,
          StatusCode: s === 1 && i < 10 ? 'Error' : 'Ok',
          StatusMessage: '',
          SpanAttributes: {},
          ResourceAttributes: {},
        })),
      ),
    );
  });

  beforeEach(async () => {
    slosEnabled = jest.replaceProperty(config, 'IS_SLOS_ENABLED', true);
    const { team, user } = await getLoggedInAgent(server);
    teamId = team._id.toString();
    const connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await Source.create({
      kind: SourceKind.Trace,
      team: team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_TRACES_TABLE },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Traces',
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      parentSpanIdExpression: 'ParentSpanId',
      spanNameExpression: 'SpanName',
      spanKindExpression: 'SpanKind',
      durationExpression: 'Duration',
      durationPrecision: 9,
      statusCodeExpression: 'StatusCode',
    });
    sourceId = source._id.toString();
    const webhook = await Webhook.create({
      name: 'On call',
      service: 'generic',
      url: 'https://example.com/hook',
      team: team._id,
    });
    webhookId = webhook._id.toString();
    const context: McpContext = { teamId, userId: user._id.toString() };
    client = await createTestClient(context);
  });

  afterEach(async () => {
    await client?.close();
    slosEnabled.restore();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('previews a grouped definition from the source', async () => {
    const { isError, text } = await call('clickstack_preview_slo', {
      definition: definition({ name: undefined, groupBy: 'ServiceName' }),
    });
    expect(isError).toBeFalsy();
    expect(JSON.parse(text)).toMatchObject({
      eligible: 100,
      good: 90,
      bad: 10,
      sli: 0.9,
      groupCount: 2,
      trackedGroups: 2,
      sql: expect.stringContaining('countIf'),
    });
    expect(await Slo.countDocuments()).toBe(0);
  });

  it('saves a batch with the checks of the SLO pages, then updates and deletes', async () => {
    const saved = JSON.parse(
      (
        await call('clickstack_save_slo', {
          slos: [
            definition({
              groupBy: 'ServiceName',
              alerts: {
                fastBurn: { channels: [{ type: 'webhook', webhookId }] },
              },
            }),
            // ClickHouse rejects the condition, so this one is not saved.
            definition({
              name: 'Typo',
              indicator: {
                ...definition().indicator,
                good: "StatusCod != 'Error'",
              },
            }),
          ],
        })
      ).text,
    );
    expect(saved).toMatchObject({ saved: 1, failed: 1 });
    expect(saved.results[1]).toMatchObject({
      index: 1,
      ok: false,
      error: expect.stringContaining('StatusCod'),
    });
    const id = saved.results[0].id;
    const slo = await Slo.findById(id).lean();
    expect(slo).toMatchObject({
      name: 'Checkout availability',
      groupBy: 'ServiceName',
    });
    expect(slo?.team.toString()).toBe(teamId);
    expect(
      await Alert.countDocuments({ slo: id, source: AlertSource.SLO }),
    ).toBe(1);

    // An update replaces the definition: without alerts, the alert goes.
    const updated = JSON.parse(
      (
        await call('clickstack_save_slo', {
          slos: [definition({ id, name: 'Checkout success' })],
        })
      ).text,
    );
    expect(updated.results[0]).toMatchObject({ ok: true, id });
    expect((await Slo.findById(id).lean())?.name).toBe('Checkout success');
    expect(await Alert.countDocuments({ slo: id })).toBe(0);

    expect(
      JSON.parse((await call('clickstack_delete_slo', { id })).text),
    ).toEqual({ deleted: true, id });
    expect(await Slo.exists({ _id: id })).toBeNull();
  });

  it("leaves another team's SLO alone", async () => {
    const other = await Slo.create({
      ...definition(),
      source: new mongoose.Types.ObjectId(),
      team: new mongoose.Types.ObjectId(),
    });
    const id = other._id.toString();
    const deleted = await call('clickstack_delete_slo', { id });
    expect(deleted.isError).toBe(true);
    expect(deleted.text).toContain('SLO not found');
    const updated = JSON.parse(
      (await call('clickstack_save_slo', { slos: [definition({ id })] })).text,
    );
    expect(updated.results[0]).toMatchObject({
      ok: false,
      error: 'SLO not found',
    });
    expect(await Slo.exists({ _id: id })).toBeTruthy();
  });
});
