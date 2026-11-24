import { tryOptimizeConfigWithMaterializedView } from '@hyperdx/common-utils/dist/core/materializedViews';
import { Types } from 'mongoose';

import { recordSloAlertBurn } from '@/controllers/sloStatus';
import { AlertState } from '@/models/alert';
import { processAlert } from '@/tasks/checkAlerts';
import { findAlertEvaluator } from '@/tasks/checkAlerts/evaluators';
import { AlertTaskType } from '@/tasks/checkAlerts/providers';
import { SLO_BURN_RATE_EVALUATOR_NAME } from '@/tasks/checkAlerts/sloEvaluator';
import * as template from '@/tasks/checkAlerts/template';

jest.mock('@hyperdx/common-utils/dist/core/materializedViews', () => ({
  tryOptimizeConfigWithMaterializedView: jest.fn(
    async (config: Record<string, unknown>) => ({ ...config, optimized: true }),
  ),
}));

// The stored snapshot is the refresh's; here it only echoes the burn numbers.
jest.mock('@/controllers/sloStatus', () => ({
  recordSloAlertBurn: jest.fn(
    async (_slo: unknown, numbers: { burn?: unknown }) => ({
      burn: numbers.burn,
      budgetRemaining: 0.5,
    }),
  ),
}));

const source: any = {
  _id: 'source-1',
  id: 'source-1',
  kind: 'trace',
  connection: 'connection-1',
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
};

const slo: any = {
  _id: new Types.ObjectId(),
  name: 'Checkout availability',
  target: 99.5,
  window: '30d',
  alerts: {
    fastBurn: { channels: [{ type: 'webhook', webhookId: 'w' }] },
    slowBurn: { channels: [{ type: 'webhook', webhookId: 'w' }] },
  },
  indicator: {
    template: 'availability',
    eligible: { where: "SpanKind = 'Server'", whereLanguage: 'sql' },
    good: "StatusCode != 'Error'",
  },
};

const makeAlert = (rule: 'fastBurn' | 'slowBurn' = 'fastBurn'): any => ({
  id: new Types.ObjectId().toString(),
  team: new Types.ObjectId(),
  source: 'slo',
  slo: slo._id,
  sloRule: rule,
  // syncSloAlerts names the alert after its SLO.
  displayName: 'Checkout availability',
  interval: rule === 'slowBurn' ? '15m' : '5m',
  threshold: 1,
  thresholdType: 'above',
  channel: { type: 'webhook', webhookId: 'w' },
  channels: [{ type: 'webhook', webhookId: 'w' }],
});

/** Where the burn query's range ends for a check at 01:07. */
const END = Date.parse('2025-01-01T01:05:00Z');

/** 5-minute bucket rows that end at END, newest last. */
const buckets = (counts: [eligible: number, good: number][]) =>
  counts.map(([eligible, good], i) => ({
    __hdx_time_bucket: new Date(
      END - (counts.length - i) * 5 * 60_000,
    ).toISOString(),
    slo_eligible: String(eligible),
    slo_good: String(good),
  }));

const repeat = (n: number, counts: [number, number]) =>
  Array.from({ length: n }, () => counts);

/** Evaluates one SLO alert against the burn query's rows. */
const evaluate = async (
  rows: Record<string, string>[] | Error,
  {
    alert = makeAlert(),
    alertSource = source,
    previousMap = new Map(),
  }: {
    alert?: any;
    alertSource?: any;
    previousMap?: Map<string, any>;
  } = {},
) => {
  const provider: any = {
    updateAlertState: jest.fn().mockResolvedValue(undefined),
    recordAlertErrors: jest.fn().mockResolvedValue(undefined),
    buildSloLink: jest.fn().mockReturnValue('http://app/slos/1'),
  };
  const client: any = {
    queryChartConfig:
      rows instanceof Error
        ? jest.fn().mockRejectedValue(rows)
        : jest.fn().mockResolvedValue({ data: rows }),
    requestTimeoutMs: 1000,
  };
  await processAlert(
    new Date('2025-01-01T01:07:00Z'),
    {
      alert,
      previousMap,
      taskType: AlertTaskType.SLO,
      source: alertSource,
      slo,
    },
    client,
    'connection-1',
    provider,
    new Map(),
  );
  const records = provider.updateAlertState.mock.calls[0]?.[1];
  return { client, provider, records };
};

describe('SLO burn-rate evaluator', () => {
  let render: jest.SpyInstance;

  beforeEach(() => {
    slo.status = undefined;
    jest.mocked(recordSloAlertBurn).mockClear();
    render = jest.spyOn(template, 'renderAlertTemplate').mockResolvedValue({
      body: '',
      failures: [],
      timings: [],
      dispatchDurationMs: 0,
    });
  });

  afterEach(() => render.mockRestore());

  it('is built in and owns SLO alerts', () => {
    expect(findAlertEvaluator(makeAlert())?.name).toBe(
      SLO_BURN_RATE_EVALUATOR_NAME,
    );
  });

  it('counts 5-minute buckets over the longest burn window, ending where the scheduled window ends', async () => {
    const { client } = await evaluate(buckets([[1000, 1000]]));
    const { config } = client.queryChartConfig.mock.calls[0][0];
    expect(config.dateRange).toEqual([
      new Date('2024-12-31T19:05:00Z'),
      new Date('2025-01-01T01:05:00Z'),
    ]);
    expect(config.granularity).toBe('5 minute');
  });

  it('fires a fast burn alert when an hour spends 2% of the budget', async () => {
    // 10 bad of 100 per bucket against a 0.5% budget: a 20x burn, over the
    // 14.4x of the fast burn. The value is how far over: 20 / 14.4.
    const { records } = await evaluate(buckets(repeat(12, [100, 90])));
    expect(records).toEqual([
      expect.objectContaining({
        state: AlertState.ALERT,
        fired: true,
        lastValues: [expect.objectContaining({ count: 1.38 })],
      }),
    ]);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        state: AlertState.ALERT,
        // 20x for an hour of a 30-day window: 20 / 720 of the budget.
        title:
          'SLO "Checkout availability": fast burn, 2.8% of the 30-day budget spent in the last hour',
        // The notification covers the rule's window.
        view: expect.objectContaining({
          startTime: new Date('2025-01-01T00:05:00Z'),
        }),
      }),
    );
    // The SLO list shows this check's verdict.
    expect(recordSloAlertBurn).toHaveBeenCalledWith(
      slo,
      {
        burn: [
          expect.objectContaining({
            window: '1h',
            burnRate: expect.closeTo(20),
          }),
          expect.objectContaining({
            window: '6h',
            burnRate: expect.closeTo(20),
          }),
        ],
      },
      expect.any(Date),
    );
  });

  it('fires the slow burn alert, and only it, when a slower burn lasts', async () => {
    // 3.5 bad of 100 for 6 hours: 7x, under the fast burn's 14.4x and over
    // the slow burn's 6x.
    const rows = buckets(repeat(72, [1000, 965]));
    const slow = await evaluate(rows, { alert: makeAlert('slowBurn') });
    expect(slow.records).toEqual([
      expect.objectContaining({
        state: AlertState.ALERT,
        lastValues: [expect.objectContaining({ count: 1.16 })],
      }),
    ]);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        title:
          'SLO "Checkout availability": slow burn, 5.8% of the 30-day budget spent in the last 6 hours',
        // Checked every 15 minutes, so the window ends at 01:00.
        view: expect.objectContaining({
          startTime: new Date('2024-12-31T19:00:00Z'),
        }),
      }),
    );
    render.mockClear();
    const fast = await evaluate(rows, { alert: makeAlert('fastBurn') });
    expect(fast.records).toEqual([
      expect.objectContaining({ state: AlertState.OK }),
    ]);
    expect(render).not.toHaveBeenCalled();
  });

  it('notifies once when a burn starts, not on every check', async () => {
    const alert = makeAlert();
    const firing = (fired: boolean) =>
      new Map([
        [
          alert.id,
          {
            state: AlertState.ALERT,
            fired,
            createdAt: new Date('2025-01-01T01:00:00Z'),
          },
        ],
      ]);
    const rows = buckets(repeat(12, [100, 90]));
    const { records } = await evaluate(rows, {
      alert,
      previousMap: firing(true),
    });
    expect(records).toEqual([
      expect.objectContaining({ state: AlertState.ALERT, fired: true }),
    ]);
    expect(render).not.toHaveBeenCalled();
    // A silence kept the start from notifying: the first check after it
    // ends does.
    await evaluate(rows, { alert, previousMap: firing(false) });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('states its burn numbers before the SLO has a stored snapshot', async () => {
    // Right after a save, the refresh may not have stored window numbers.
    jest.mocked(recordSloAlertBurn).mockResolvedValueOnce(null);
    await evaluate(buckets(repeat(12, [100, 90])));
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        title:
          'SLO "Checkout availability": fast burn, 2.8% of the 30-day budget spent in the last hour',
      }),
    );
  });

  it('lets a materialized view of the source serve its query', async () => {
    const withView = {
      ...source,
      materializedViews: [
        { databaseName: 'otel', tableName: 'otel_traces_1m' },
      ],
    };
    const { client } = await evaluate(buckets([[1000, 1000]]), {
      alertSource: withView,
    });
    expect(tryOptimizeConfigWithMaterializedView).toHaveBeenCalled();
    expect(client.queryChartConfig.mock.calls[0][0].config).toEqual(
      expect.objectContaining({ optimized: true }),
    );
  });

  it('stays OK once the short windows stop burning', async () => {
    // A burn in the first half of the hour: both long windows still remember
    // it, the last 5 and 30 minutes are clean.
    const { records } = await evaluate(
      buckets([...repeat(6, [100, 80]), ...repeat(6, [100, 100])]),
    );
    expect(records).toEqual([
      expect.objectContaining({ state: AlertState.OK }),
    ]);
    expect(render).not.toHaveBeenCalled();
  });

  it('records a failed query as a query error, leaving the state alone', async () => {
    const { provider, records } = await evaluate(
      new Error('Unknown expression identifier `StatusCod`'),
    );
    expect(records).toBeUndefined();
    expect(provider.recordAlertErrors).toHaveBeenCalledWith(
      expect.any(String),
      [
        expect.objectContaining({
          type: 'QUERY_ERROR',
          message: expect.stringContaining('StatusCod'),
        }),
      ],
    );
  });

  it('stays OK below the thresholds or with too few events', async () => {
    // 2 bad of 100 for 6 hours: 4x, under both thresholds.
    const slow = await evaluate(buckets(repeat(72, [100, 98])));
    expect(slow.records).toEqual([
      expect.objectContaining({ state: AlertState.OK }),
    ]);
    // 5 of 10 bad is a 100x burn, but under the 20-event minimum for 1h and
    // the 100-event minimum for 6h.
    const quiet = await evaluate(buckets([[10, 5]]));
    expect(quiet.records).toEqual([
      expect.objectContaining({ state: AlertState.OK }),
    ]);
  });
  describe('for a grouped SLO', () => {
    /** Rows of the burn query by group, for one group. */
    const groupBuckets = (
      value: string,
      counts: [eligible: number, good: number][],
    ) => buckets(counts).map(row => ({ ...row, slo_group: value }));

    /** A group the status refresh tracks, with its window events. */
    const tracked = (value: string, eligible = 10_000) => ({
      value,
      eligible,
      good: eligible,
      burn: [],
      state: 'healthy',
    });

    /** A history of the previous check, which alerted. */
    const alerted = (groupValues?: { key: string; value: string }[]) => ({
      state: AlertState.ALERT,
      fired: true,
      createdAt: new Date('2025-01-01T01:00:00Z'),
      ...(groupValues ? { groupValues } : {}),
    });

    beforeEach(() => {
      slo.groupBy = 'ServiceName';
      slo.status = {
        groups: [tracked('checkout'), tracked('cart'), tracked('canary', 50)],
      };
    });

    afterEach(() => {
      slo.groupBy = undefined;
    });

    it('waits until the status refresh has picked the groups', async () => {
      slo.status = undefined;
      const { client, provider, records } = await evaluate(
        groupBuckets('checkout', repeat(12, [100, 90])),
      );
      expect(client.queryChartConfig).not.toHaveBeenCalled();
      expect(records).toBeUndefined();
      expect(provider.recordAlertErrors).toHaveBeenCalledWith(
        expect.any(String),
        [],
      );
    });

    it('fires for each burning group with enough events, naming the group', async () => {
      const { client, records } = await evaluate([
        // 20x, as above.
        ...groupBuckets('checkout', repeat(12, [100, 90])),
        ...groupBuckets('cart', repeat(12, [100, 100])),
        // 100x, but too few events in the window to judge.
        ...groupBuckets('canary', repeat(12, [100, 50])),
      ]);
      // By group, for the tracked groups only.
      const { config } = client.queryChartConfig.mock.calls[0][0];
      expect(config.filters).toContainEqual({
        type: 'sql',
        condition: "toString(ServiceName) IN ('checkout', 'cart', 'canary')",
      });
      expect(records).toHaveLength(3);
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            group: 'ServiceName:checkout',
            state: AlertState.ALERT,
            groupValues: [{ key: 'ServiceName', value: 'checkout' }],
          }),
          expect.objectContaining({
            group: 'ServiceName:cart',
            state: AlertState.OK,
          }),
          expect.objectContaining({
            group: 'ServiceName:canary',
            state: AlertState.OK,
          }),
        ]),
      );
      expect(render).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          title:
            'SLO "Checkout availability" (ServiceName:checkout): fast burn, 2.8% of the 30-day budget spent in the last hour',
          view: expect.objectContaining({
            group: 'ServiceName:checkout',
            isGroupedAlert: true,
            attributes: { ServiceName: 'checkout' },
          }),
        }),
      );
      // Each tracked group's burn numbers go to the SLO list.
      const [, stored] = jest.mocked(recordSloAlertBurn).mock.calls[0];
      expect([...(stored.groups?.keys() ?? [])]).toEqual([
        'checkout',
        'cart',
        'canary',
      ]);
      expect(stored.burn).toBeUndefined();
    });

    it('resolves a group that alerted and is no longer tracked', async () => {
      const alert = makeAlert();
      const { records } = await evaluate(
        groupBuckets('cart', repeat(12, [100, 100])),
        {
          alert,
          previousMap: new Map([
            [
              `${alert.id}||ServiceName:retired`,
              alerted([{ key: 'ServiceName', value: 'retired' }]),
            ],
          ]),
        },
      );
      expect(records).toContainEqual(
        expect.objectContaining({
          group: 'ServiceName:retired',
          state: AlertState.OK,
        }),
      );
      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          state: AlertState.OK,
          title:
            'SLO "Checkout availability" (ServiceName:retired): fast burn resolved',
          view: expect.objectContaining({
            attributes: { ServiceName: 'retired' },
          }),
        }),
      );
    });

    it('resolves the whole SLO once it is grouped', async () => {
      const alert = makeAlert();
      const { records } = await evaluate(
        groupBuckets('cart', repeat(12, [100, 100])),
        { alert, previousMap: new Map([[alert.id, alerted()]]) },
      );
      expect(records).toContainEqual(
        expect.objectContaining({ group: undefined, state: AlertState.OK }),
      );
      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          state: AlertState.OK,
          title: 'SLO "Checkout availability": fast burn resolved',
        }),
      );
    });
  });
});
