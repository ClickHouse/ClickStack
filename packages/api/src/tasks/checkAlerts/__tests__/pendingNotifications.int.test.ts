import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { AlertErrorType } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import ms from 'ms';

import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import { bulkInsertLogs, getServer } from '@/fixtures';
import Alert, {
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import PendingNotification from '@/models/pendingNotification';
import Webhook, { IWebhook } from '@/models/webhook';
import { getPreviousAlertHistories, processAlert } from '@/tasks/checkAlerts';
import { resendPendingNotifications } from '@/tasks/checkAlerts/pendingNotifications';
import {
  AlertProvider,
  AlertTaskType,
  loadProvider,
} from '@/tasks/checkAlerts/providers';

import {
  HOOK_BAD,
  HOOK_OK,
  makeGenericWebhook,
  setupAlertFixtures,
} from './multiChannelAlerts.harness';

const FIRING_AT = new Date('2023-11-16T22:12:00.000Z');
const RESOLVING_AT = new Date('2023-11-16T22:17:00.000Z');
// The 5m window RESOLVING_AT evaluates, where its history rows are written.
const RESOLVED_WINDOW = new Date('2023-11-16T22:15:00.000Z');
const minutesAfterResolve = (minutes: number) =>
  new Date(RESOLVING_AT.getTime() + ms(`${minutes}m`));

type Request = { url: string; idempotencyKey?: string; body: string };

describe('sending failed resolves again', () => {
  let alertProvider: AlertProvider;
  let server: ReturnType<typeof getServer>;
  let requests: Request[];
  // Endpoints that currently fail every request.
  let down: Set<string>;

  beforeAll(async () => {
    alertProvider = await loadProvider();
    server = getServer();
    await server.start();
  });

  beforeEach(() => {
    requests = [];
    down = new Set();
    jest.mocked(global.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        idempotencyKey:
          new Headers(init?.headers).get('Idempotency-Key') ?? undefined,
        body: String(init?.body),
      });
      if (down.has(url)) {
        // 400 so withRetry does not retry within one delivery.
        return new Response('unavailable', { status: 400 });
      }
      return new Response('ok', { status: 200 });
    });
  });

  afterEach(async () => {
    await server.clearDBs();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  const setup = async (
    webhookUrls: string[] = [HOOK_OK],
  ): Promise<{
    alertId: string;
    webhooks: IWebhook[];
    evaluate: (now: Date) => Promise<void>;
    resend: (now: Date, webhooks?: IWebhook[]) => Promise<void>;
  }> => {
    const { team, connection, source, savedSearch } =
      await setupAlertFixtures(createTeam);
    const webhooks = await Promise.all(
      webhookUrls.map((url, i) =>
        makeGenericWebhook(team._id, `Hook ${i}`, url),
      ),
    );
    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channels: webhooks.map(w => ({
          type: 'webhook' as const,
          webhookId: w._id.toString(),
        })),
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1,
        savedSearchId: savedSearch.id,
        name: 'Resend Alert',
      },
      new mongoose.Types.ObjectId(),
    );
    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });
    const webhooksById = (list: IWebhook[]) =>
      new Map(list.map(w => [w._id.toString(), w]));

    const evaluate = async (now: Date) => {
      const enhancedAlert: any = await Alert.findById(alert.id).populate([
        'team',
        'savedSearch',
      ]);
      await processAlert(
        now,
        {
          alert: enhancedAlert,
          source,
          taskType: AlertTaskType.SAVED_SEARCH,
          savedSearch,
          previousMap: await getPreviousAlertHistories([alert.id], now),
        },
        clickhouseClient,
        connection.id,
        alertProvider,
        webhooksById(webhooks),
      );
    };

    const resend = async (now: Date, available: IWebhook[] = webhooks) => {
      const previousMap = await getPreviousAlertHistories([alert.id], now);
      await resendPendingNotifications({
        alert: (await Alert.findById(alert.id))!,
        // Non-grouped alerts key their history by the bare alert id.
        getPreviousState: () => previousMap.get(alert.id)?.state,
        now,
        pending: await alertProvider.getPendingNotifications([alert.id]),
        provider: alertProvider,
        teamWebhooksById: webhooksById(available),
      });
    };

    return { alertId: alert.id, webhooks, evaluate, resend };
  };

  const seedErrorLogs = (at: Date) =>
    bulkInsertLogs(
      [0, 1].map(() => ({
        ServiceName: 'api',
        Timestamp: at,
        SeverityText: 'error',
        Body: 'Test error message',
      })),
    );

  // Fires at FIRING_AT, then resolves at RESOLVING_AT while `failing` is down.
  const fireThenFailResolve = async (
    ctx: Awaited<ReturnType<typeof setup>>,
    failing: string[] = [HOOK_OK],
  ) => {
    await seedErrorLogs(new Date(FIRING_AT.getTime() - ms('3m')));
    await ctx.evaluate(FIRING_AT);
    failing.forEach(url => down.add(url));
    await ctx.evaluate(RESOLVING_AT);
    requests = [];
  };

  it('stores a resolve whose delivery failed', async () => {
    const ctx = await setup();
    await fireThenFailResolve(ctx);

    const alert = await Alert.findById(ctx.alertId);
    expect(alert!.state).toBe(AlertState.OK);
    expect(alert!.executionErrors?.[0]?.type).toBe(
      AlertErrorType.WEBHOOK_ERROR,
    );
    const records = await PendingNotification.find({ alert: ctx.alertId });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      group: '',
      attempts: 1,
      windowStart: RESOLVED_WINDOW,
      firstFailedAt: RESOLVING_AT,
      nextAttemptAt: minutesAfterResolve(1),
    });
    expect(records[0].webhook.toString()).toBe(ctx.webhooks[0]._id.toString());
    expect(JSON.parse(records[0].message).state).toBe(AlertState.OK);
  });

  it('delivers the resolve on a later tick with the same idempotency key', async () => {
    const ctx = await setup();
    await seedErrorLogs(new Date(FIRING_AT.getTime() - ms('3m')));
    await ctx.evaluate(FIRING_AT);
    down.add(HOOK_OK);
    await ctx.evaluate(RESOLVING_AT);
    const failedResolve = requests[requests.length - 1];

    requests = [];
    down.clear();
    await ctx.resend(minutesAfterResolve(1));

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(HOOK_OK);
    expect(requests[0].idempotencyKey).toBe(failedResolve.idempotencyKey);
    expect(requests[0].body).toBe(failedResolve.body);
    expect(await PendingNotification.countDocuments()).toBe(0);
  });

  it('backs off after another failure', async () => {
    const ctx = await setup();
    await fireThenFailResolve(ctx);

    await ctx.resend(minutesAfterResolve(1));
    expect(requests).toHaveLength(1);
    const record = await PendingNotification.findOne({ alert: ctx.alertId });
    expect(record).toMatchObject({
      attempts: 2,
      nextAttemptAt: minutesAfterResolve(3),
    });

    requests = [];
    await ctx.resend(minutesAfterResolve(2));
    expect(requests).toHaveLength(0);
  });

  it('only stores the channels that failed', async () => {
    const ctx = await setup([HOOK_OK, HOOK_BAD]);
    await fireThenFailResolve(ctx, [HOOK_BAD]);

    const records = await PendingNotification.find({ alert: ctx.alertId });
    expect(records.map(r => r.webhook.toString())).toEqual([
      ctx.webhooks[1]._id.toString(),
    ]);

    await ctx.resend(minutesAfterResolve(1));
    expect(requests.map(r => r.url)).toEqual([HOOK_BAD]);
  });

  it('does not store a failed ALERT, which the next evaluation sends again', async () => {
    const ctx = await setup();
    await seedErrorLogs(new Date(FIRING_AT.getTime() - ms('3m')));
    down.add(HOOK_OK);
    await ctx.evaluate(FIRING_AT);

    expect((await Alert.findById(ctx.alertId))!.state).toBe(AlertState.ALERT);
    expect(await PendingNotification.countDocuments()).toBe(0);
  });

  it('drops the resolve once the group fires again', async () => {
    const ctx = await setup();
    await fireThenFailResolve(ctx);
    down.clear();
    await seedErrorLogs(minutesAfterResolve(1));
    await ctx.evaluate(minutesAfterResolve(5));
    requests = [];

    await ctx.resend(minutesAfterResolve(6));

    expect(requests).toHaveLength(0);
    expect(await PendingNotification.countDocuments()).toBe(0);
  });

  it('records an error on the resolved window and stops after 24 hours', async () => {
    const ctx = await setup();
    await fireThenFailResolve(ctx);

    await ctx.resend(new Date(RESOLVING_AT.getTime() + ms('24h')));

    expect(requests).toHaveLength(0);
    expect(await PendingNotification.countDocuments()).toBe(0);
    const errorRow = await AlertHistory.findOne({
      alert: ctx.alertId,
      createdAt: RESOLVED_WINDOW,
      state: AlertState.ERROR,
    });
    expect(errorRow!.errors).toHaveLength(2);
    expect(errorRow!.errors![1]).toMatchObject({
      type: AlertErrorType.WEBHOOK_ERROR,
      message: expect.stringContaining(
        'Resolve notification to webhook "Hook 0" was not delivered within 1 day (1 attempt)',
      ),
    });
  });

  it('drops the resolve when its webhook was deleted', async () => {
    const ctx = await setup();
    await fireThenFailResolve(ctx);
    await Webhook.deleteOne({ _id: ctx.webhooks[0]._id });

    await ctx.resend(minutesAfterResolve(1), []);

    expect(requests).toHaveLength(0);
    expect(await PendingNotification.countDocuments()).toBe(0);
  });

  it('holds the resolve while the alert is silenced', async () => {
    const ctx = await setup();
    await fireThenFailResolve(ctx);
    await Alert.updateOne(
      { _id: ctx.alertId },
      {
        $set: {
          silenced: { at: RESOLVING_AT, until: minutesAfterResolve(60) },
        },
      },
    );

    await ctx.resend(minutesAfterResolve(1));

    expect(requests).toHaveLength(0);
    expect(
      await PendingNotification.findOne({ alert: ctx.alertId }),
    ).toMatchObject({ attempts: 1 });
  });
});
