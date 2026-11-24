import { SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import * as config from '@/config';
import {
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
});
