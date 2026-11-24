import { SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import * as config from '@/config';
import { refreshDueSloStatuses } from '@/controllers/sloStatus';
import {
  bulkInsertData,
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import Slo from '@/models/slo';
import { Source } from '@/models/source';

// ClickHouse is shared across tests and files, so scope every SLO to this
// run's service.
const SERVICE = `slo-${Date.now()}`;

describe('SLO router', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let sourceId: string;

  const definition = (overrides: Record<string, unknown> = {}) => ({
    name: 'Checkout availability',
    source: sourceId,
    indicator: {
      template: 'availability',
      eligible: { where: `ServiceName = '${SERVICE}'`, whereLanguage: 'sql' },
      good: "StatusCode != 'Error'",
    },
    target: 99,
    window: '7d',
    ...overrides,
  });

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    const connection = await Connection.create({
      team: result.team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await Source.create({
      kind: SourceKind.Trace,
      team: result.team._id,
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
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('creates, lists, updates and deletes an SLO', async () => {
    const created = await agent.post('/slos').send(definition()).expect(200);
    expect(created.body).toEqual(
      expect.objectContaining({
        name: 'Checkout availability',
        source: sourceId,
        target: 99,
        window: '7d',
        alerts: {},
        // Computed in the background, never in the request.
        status: null,
      }),
    );
    const id = created.body.id;

    const list = await agent.get('/slos').expect(200);
    expect(list.body.map((slo: { id: string }) => slo.id)).toEqual([id]);

    await agent
      .put(`/slos/${id}`)
      .send(definition({ name: 'Checkout success' }))
      .expect(200);
    const fetched = await agent.get(`/slos/${id}`).expect(200);
    expect(fetched.body.name).toBe('Checkout success');

    await agent.delete(`/slos/${id}`).expect(204);
    await agent.get(`/slos/${id}`).expect(404);
  });

  it('rejects a definition it cannot save, saying why', async () => {
    await agent
      .post('/slos')
      .send(definition({ name: ' ' }))
      .expect(400);
    await agent
      .post('/slos')
      .send(
        definition({
          indicator: {
            template: 'availability',
            eligible: { where: '', whereLanguage: 'sql' },
          },
        }),
      )
      .expect(400);
    // ClickHouse cannot run the condition: the save fails with its message.
    const rejected = await agent
      .post('/slos')
      .send(
        definition({
          indicator: {
            template: 'availability',
            eligible: { where: '', whereLanguage: 'sql' },
            good: "StatusCod != 'Error'",
          },
        }),
      )
      .expect(400);
    expect(rejected.body.message).toContain('StatusCod');
    expect(await Slo.countDocuments()).toBe(0);
  });

  it("does not expose another team's SLO", async () => {
    const other = await Slo.create({
      ...definition(),
      source: new mongoose.Types.ObjectId(),
      team: new mongoose.Types.ObjectId(),
    });
    const id = other._id.toString();

    await agent.get(`/slos/${id}`).expect(404);
    await agent.put(`/slos/${id}`).send(definition()).expect(404);
    await agent.delete(`/slos/${id}`).expect(404);
    expect((await agent.get('/slos').expect(200)).body).toEqual([]);
    expect(await Slo.exists({ _id: id })).toBeTruthy();
  });

  it('computes the status in the background, counting a NULL condition as bad', async () => {
    // Seven good spans, two bad, and one whose condition is NULL.
    const ok = [...Array(7).fill('1'), '0', '0', undefined];
    const now = Date.now();
    await bulkInsertData(
      `${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
      ok.map((value, i) => ({
        Timestamp: new Date(now - (i + 1) * 60_000),
        TraceId: `${SERVICE}-trace-${i}`,
        SpanId: `${SERVICE}-span-${i}`,
        ParentSpanId: '',
        SpanName: 'POST /checkout',
        SpanKind: 'Server',
        ServiceName: SERVICE,
        Duration: 100 * 1e6,
        StatusCode: 'Ok',
        StatusMessage: '',
        SpanAttributes: value == null ? {} : { ok: value },
        ResourceAttributes: {},
      })),
    );
    const created = await agent
      .post('/slos')
      .send(
        definition({
          indicator: {
            template: 'availability',
            eligible: {
              where: `ServiceName = '${SERVICE}'`,
              whereLanguage: 'sql',
            },
            good: "toUInt8OrNull(SpanAttributes['ok']) = 1",
          },
        }),
      )
      .expect(200);

    await refreshDueSloStatuses();

    const { body } = await agent.get(`/slos/${created.body.id}`).expect(200);
    expect(body.status).toEqual(
      expect.objectContaining({
        eligible: 10,
        good: 7,
        bad: 3,
        state: 'breached',
        error: null,
      }),
    );
    // A refresh is not an edit.
    expect(body.updatedAt).toBe(created.body.updatedAt);
  });

  it('refreshes the burn numbers every few minutes and the window numbers less often', async () => {
    const created = await agent.post('/slos').send(definition()).expect(200);
    const t0 = Date.now();
    const iso = (minutes: number) =>
      new Date(t0 + minutes * 60_000).toISOString();
    const statusAt = async (minutes: number) => {
      await refreshDueSloStatuses(new Date(t0 + minutes * 60_000));
      return (await agent.get(`/slos/${created.body.id}`).expect(200)).body
        .status;
    };

    expect(await statusAt(0)).toMatchObject({
      evaluatedAt: iso(0),
      windowEvaluatedAt: iso(0),
    });
    // Burn numbers are due after 5 minutes, window numbers after 30.
    expect(await statusAt(6)).toMatchObject({
      evaluatedAt: iso(6),
      windowEvaluatedAt: iso(0),
    });
    expect(await statusAt(31)).toMatchObject({
      evaluatedAt: iso(31),
      windowEvaluatedAt: iso(31),
    });
  });

  it('tracks each group of a grouped SLO, the worst first', async () => {
    // One service with every span good, one with a third of them bad, and
    // one with too few spans to judge.
    const base = `${SERVICE}-group`;
    // Before the last 5-minute boundary, where the burn windows end.
    const end = Math.floor(Date.now() / 300_000) * 300_000;
    const spans = (service: string, count: number, bad: number) =>
      Array.from({ length: count }, (_, i) => ({
        Timestamp: new Date(end - (i + 1) * 20_000),
        TraceId: `${service}-trace-${i}`,
        SpanId: `${service}-span-${i}`,
        ParentSpanId: '',
        SpanName: 'POST /checkout',
        SpanKind: 'Server',
        ServiceName: service,
        Duration: 100 * 1e6,
        StatusCode: i < bad ? 'Error' : 'Ok',
        StatusMessage: '',
        SpanAttributes: {},
        ResourceAttributes: {},
      }));
    await bulkInsertData(`${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`, [
      ...spans(`${base}-a`, 150, 0),
      ...spans(`${base}-b`, 120, 40),
      ...spans(`${base}-c`, 10, 0),
    ]);
    const created = await agent
      .post('/slos')
      .send(
        definition({
          indicator: {
            template: 'availability',
            eligible: {
              where: `startsWith(ServiceName, '${base}-')`,
              whereLanguage: 'sql',
            },
            good: "StatusCode != 'Error'",
          },
          groupBy: 'ServiceName',
        }),
      )
      .expect(200);
    expect(created.body.groupBy).toBe('ServiceName');

    await refreshDueSloStatuses();

    const { body } = await agent.get(`/slos/${created.body.id}`).expect(200);
    expect(body.status).toMatchObject({
      eligible: 280,
      good: 240,
      groupCount: 3,
      // As bad as its worst group with enough events.
      state: 'breached',
    });
    expect(body.status.groups).toEqual([
      expect.objectContaining({
        value: `${base}-b`,
        eligible: 120,
        good: 80,
        state: 'breached',
      }),
      expect.objectContaining({
        value: `${base}-a`,
        eligible: 150,
        good: 150,
        state: 'healthy',
      }),
      expect.objectContaining({
        value: `${base}-c`,
        eligible: 10,
        state: 'insufficient_data',
      }),
    ]);
    // Each group has its own burn numbers: the bad spans are the latest.
    expect(body.status.groups[0].burn[0]).toMatchObject({
      window: '1h',
      eligible: 120,
      bad: 40,
    });
    expect(body.status.groups[1].burn[0]).toMatchObject({ bad: 0 });
  });

  it('drops the status when what it measures changes, not when the name does', async () => {
    const created = await agent.post('/slos').send(definition()).expect(200);
    const id = created.body.id;
    await refreshDueSloStatuses();
    const statusOf = async () =>
      (await agent.get(`/slos/${id}`).expect(200)).body.status;
    expect(await statusOf()).not.toBeNull();

    await agent
      .put(`/slos/${id}`)
      .send(definition({ name: 'Renamed' }))
      .expect(200);
    expect(await statusOf()).not.toBeNull();

    await agent
      .put(`/slos/${id}`)
      .send(definition({ name: 'Renamed', target: 95 }))
      .expect(200);
    expect(await statusOf()).toBeNull();
  });
});
