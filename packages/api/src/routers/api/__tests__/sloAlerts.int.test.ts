import { SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import * as config from '@/config';
import {
  deleteAlert,
  SLO_ALERT_MESSAGE,
  updateAlert,
} from '@/controllers/alerts';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import Connection from '@/models/connection';
import Slo from '@/models/slo';
import { Source } from '@/models/source';
import type { IUser } from '@/models/user';
import Webhook from '@/models/webhook';

describe('SLO alerts', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let team: Awaited<ReturnType<typeof getLoggedInAgent>>['team'];
  let user: IUser;
  let sourceId: string;
  let webhookId: string;

  const definition = (alerts: unknown) => ({
    name: 'Checkout availability',
    source: sourceId,
    indicator: {
      template: 'availability',
      eligible: { where: "SpanKind = 'Server'", whereLanguage: 'sql' },
      good: "StatusCode != 'Error'",
    },
    target: 99.9,
    window: '7d',
    alerts,
  });
  const notify = (id = webhookId) => ({
    channels: [{ type: 'webhook', webhookId: id }],
  });
  /** The fast burn alert only, to the team's webhook. */
  const fastOnly = () => ({ fastBurn: notify() });

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;
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
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  const sloAlerts = (sloId: string) => Alert.find({ slo: sloId }).lean();

  it('keeps one alert per burn alert that is on, in step with the SLO', async () => {
    const created = await agent
      .post('/slos')
      .send(definition(fastOnly()))
      .expect(200);
    const sloId = created.body.id;
    const [fast] = await sloAlerts(sloId);
    // Its value is how close the rule's condition is to holding, so it
    // fires at 1.
    expect(fast).toEqual(
      expect.objectContaining({
        source: AlertSource.SLO,
        sloRule: 'fastBurn',
        displayName: 'Checkout availability',
        interval: '5m',
        threshold: 1,
        thresholdType: 'above',
      }),
    );
    expect(created.body.alertStates).toEqual({
      fastBurn: { id: fast._id.toString(), state: 'OK', silencedUntil: null },
    });

    // The slow burn alert notifies elsewhere; the fast one stays the same
    // alert.
    const ticket = await Webhook.create({
      name: 'Team channel',
      service: 'generic',
      url: 'https://example.com/team',
      team: team._id,
    });
    await agent
      .put(`/slos/${sloId}`)
      .send(
        definition({
          fastBurn: notify(),
          slowBurn: notify(ticket._id.toString()),
        }),
      )
      .expect(200);
    const both = await sloAlerts(sloId);
    expect(both).toHaveLength(2);
    const slow = both.find(a => a.sloRule === 'slowBurn');
    expect(slow).toEqual(
      expect.objectContaining({
        interval: '15m',
        channels: [
          expect.objectContaining({ webhookId: ticket._id.toString() }),
        ],
      }),
    );
    expect(both.find(a => a.sloRule === 'fastBurn')?._id.toString()).toBe(
      fast._id.toString(),
    );

    // Turning the fast one off leaves the slow one.
    await agent
      .put(`/slos/${sloId}`)
      .send(definition({ slowBurn: notify(ticket._id.toString()) }))
      .expect(200);
    expect((await sloAlerts(sloId)).map(a => a.sloRule)).toEqual(['slowBurn']);

    await agent.put(`/slos/${sloId}`).send(definition({})).expect(200);
    expect(await sloAlerts(sloId)).toEqual([]);

    await agent.put(`/slos/${sloId}`).send(definition(fastOnly())).expect(200);
    await agent.delete(`/slos/${sloId}`).expect(204);
    expect(await sloAlerts(sloId)).toEqual([]);
  });

  it("refuses a channel the team doesn't have, saving nothing", async () => {
    await agent
      .post('/slos')
      .send(
        definition({
          fastBurn: notify(),
          slowBurn: notify(new mongoose.Types.ObjectId().toString()),
        }),
      )
      .expect(400);
    expect(await Slo.countDocuments()).toBe(0);
    expect(await Alert.countDocuments()).toBe(0);
  });

  it('keeps the generic alert controllers from changing an alert its SLO manages', async () => {
    const created = await agent
      .post('/slos')
      .send(definition(fastOnly()))
      .expect(200);
    const alertId = created.body.alertStates.fastBurn.id;

    await expect(
      updateAlert(alertId, team._id, {
        source: AlertSource.SAVED_SEARCH,
        savedSearchId: new mongoose.Types.ObjectId().toString(),
        interval: '5m',
        threshold: 1,
        thresholdType: AlertThresholdType.ABOVE,
        channel: { type: 'webhook', webhookId },
      }),
    ).rejects.toMatchObject({ name: SLO_ALERT_MESSAGE });
  });

  it('turns that burn alert off on the SLO when its alert is deleted', async () => {
    const created = await agent
      .post('/slos')
      .send(definition({ fastBurn: notify(), slowBurn: notify() }))
      .expect(200);
    const alertId = created.body.alertStates.slowBurn.id;

    await agent.delete(`/alerts/${alertId}`).expect(200);

    expect(await Alert.exists({ _id: alertId })).toBeNull();
    const slo = await agent.get(`/slos/${created.body.id}`).expect(200);
    expect(slo.body.alerts).toEqual({ fastBurn: notify(), slowBurn: null });
    expect(Object.keys(slo.body.alertStates)).toEqual(['fastBurn']);
  });

  it('deletes an alert whose SLO is gone', async () => {
    const created = await agent
      .post('/slos')
      .send(definition(fastOnly()))
      .expect(200);
    const alertId = created.body.alertStates.fastBurn.id;

    await Slo.deleteOne({ _id: created.body.id });
    await deleteAlert(alertId, team._id);
    expect(await Alert.exists({ _id: alertId })).toBeNull();
  });

  it('leaves SLO alerts out of the external API', async () => {
    const created = await agent
      .post('/slos')
      .send(definition(fastOnly()))
      .expect(200);
    const alertId = created.body.alertStates.fastBurn.id;
    const auth = `Bearer ${user.accessKey}`;

    await agent
      .get(`/api/v2/alerts/${alertId}`)
      .set('Authorization', auth)
      .expect(404);
    await agent
      .delete(`/api/v2/alerts/${alertId}`)
      .set('Authorization', auth)
      .expect(404);
    await agent
      .post(`/api/v2/alerts/${alertId}/silenced`)
      .set('Authorization', auth)
      .send({ mutedUntil: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(404);
    const list = await agent
      .get('/api/v2/alerts')
      .set('Authorization', auth)
      .expect(200);
    expect(list.body.data.map((a: { id: string }) => a.id)).not.toContain(
      alertId,
    );
    expect(await Alert.exists({ _id: alertId })).toBeTruthy();
  });
});
