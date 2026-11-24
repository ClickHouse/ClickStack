import { parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import {
  buildSloBadEventsSearch,
  buildSloBurnChartConfig,
  buildSloCountsChartConfig,
  getSloBurnCounts,
  getSloGroupKey,
  getSloGroupValue,
  parseSloCountsRow,
  parseSloGroupCountRow,
  parseSloGroupHistoryRows,
  parseSloGroupRows,
  parseSloHistoryRows,
  SloQueryDefinition,
  sumSloBuckets,
} from '@/core/slo';
import {
  buildSloLatencyGoodSql,
  getSloDefaultDuration,
} from '@/core/sloLatency';
import {
  describeSloAlertRule,
  describeSloAlertRuleDetails,
  SloInputSchema,
} from '@/slo';
import { SourceKind, TSource } from '@/types';

const traceSource = {
  id: 'source-1',
  kind: SourceKind.Trace,
  name: 'Traces',
  connection: 'conn-1',
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, ServiceName',
  durationExpression: 'Duration',
  durationPrecision: 9,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  statusCodeExpression: 'StatusCode',
  serviceNameExpression: 'ServiceName',
} as unknown as TSource;

const availability: SloQueryDefinition = {
  indicator: {
    template: 'availability',
    eligible: {
      where: "SpanKind = 'Server'",
      whereLanguage: 'sql',
      filters: [{ type: 'sql', condition: "ServiceName IN ('checkout')" }],
    },
    good: "StatusCode != 'Error'",
  },
};

const logLatency: SloQueryDefinition = {
  indicator: {
    template: 'latency',
    eligible: { where: 'ServiceName:checkout', whereLanguage: 'lucene' },
    latency: {
      expression: "LogAttributes['latency_ms']",
      unit: 'ms',
      thresholdMs: 300,
      numeric: false,
      requireDuration: true,
    },
  },
};

const dateRange: [Date, Date] = [
  new Date('2026-11-01T00:00:00Z'),
  new Date('2026-11-08T00:00:00Z'),
];

describe('SLO query generator', () => {
  const metadata = {
    getColumns: jest.fn().mockResolvedValue([]),
    getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
    getColumn: jest.fn().mockResolvedValue(undefined),
    getTableMetadata: jest.fn().mockResolvedValue({ primary_key: 'Timestamp' }),
    getSkipIndices: jest.fn().mockResolvedValue([]),
    getSetting: jest.fn().mockResolvedValue(undefined),
    isClickHouseCloud: jest.fn().mockResolvedValue(false),
  } as unknown as Metadata;

  const render = async (config: Parameters<typeof renderChartConfig>[0]) =>
    parameterizedQueryToSql(
      await renderChartConfig(config, metadata, undefined),
    );

  it('counts eligible and good events over the range', async () => {
    const sql = await render(
      buildSloCountsChartConfig({
        slo: availability,
        source: traceSource,
        dateRange,
      }),
    );
    expect(sql).toContain('count() AS "slo_eligible"');
    expect(sql).toContain('countIf(StatusCode != \'Error\') AS "slo_good"');
    expect(sql).toContain("(SpanKind = 'Server')");
    expect(sql).toContain("(ServiceName IN ('checkout'))");
    expect(sql).toMatchSnapshot();
  });

  it('counts the burn windows in 5-minute buckets ending on a boundary', async () => {
    const config = buildSloBurnChartConfig({
      slo: availability,
      source: traceSource,
      now: new Date('2026-11-07T23:58:30Z'),
    });
    expect(config.dateRange).toEqual([
      new Date('2026-11-07T17:55:00Z'),
      new Date('2026-11-07T23:55:00Z'),
    ]);
    expect(config.granularity).toBe('5 minute');
    // No timestamp in a count's condition: the buckets carry the time.
    const sql = await render(config);
    expect(sql).not.toContain('countIf(Timestamp');
    expect(sql).toContain('countIf(StatusCode != \'Error\') AS "slo_good"');
    expect(sql).toContain('INTERVAL 5 minute');
  });

  it('counts the busiest groups, one more than are tracked', async () => {
    const sql = await render(
      buildSloCountsChartConfig({
        slo: { ...availability, groupBy: 'ServiceName' },
        source: traceSource,
        dateRange,
        scope: { byGroup: true },
      }),
    );
    expect(sql).toContain('toString(ServiceName) AS "slo_group"');
    expect(sql).toMatch(/ORDER BY slo_eligible DESC\s+LIMIT 101/);
  });

  it('counts the burn buckets of the tracked groups only', async () => {
    const sql = await render(
      buildSloBurnChartConfig({
        slo: { ...availability, groupBy: 'ServiceName' },
        source: traceSource,
        now: new Date('2026-11-07T23:58:30Z'),
        scope: { byGroup: true, groups: ['checkout', "o'clock"] },
      }),
    );
    expect(sql).toContain(
      "(toString(ServiceName) IN ('checkout', 'o''clock'))",
    );
    expect(sql).toContain('INTERVAL 5 minute');
    expect(sql).toContain('toString(ServiceName) AS "slo_group"');
    expect(sql).not.toContain('LIMIT');
  });

  it('scopes a query to one group', async () => {
    const sql = await render(
      buildSloCountsChartConfig({
        slo: { ...availability, groupBy: 'ServiceName' },
        source: traceSource,
        dateRange,
        scope: { group: 'checkout' },
      }),
    );
    expect(sql).toContain("(toString(ServiceName) = 'checkout')");
    expect(sql).not.toContain('slo_group');
  });

  it('ignores group scopes on an SLO without a group-by', async () => {
    const config = buildSloCountsChartConfig({
      slo: availability,
      source: traceSource,
      dateRange,
      scope: { byGroup: true },
    });
    expect(config.groupBy).toBeUndefined();
    expect(config.limit).toBeUndefined();
  });

  it('casts an attribute duration and leaves out events without one', async () => {
    const sql = await render(
      buildSloCountsChartConfig({
        slo: logLatency,
        source: traceSource,
        dateRange,
        granularity: '1 hour',
      }),
    );
    expect(sql).toContain(
      "countIf(accurateCastOrNull(LogAttributes['latency_ms'], 'Float64') <= 300)",
    );
    expect(sql).toContain(
      "isNotNull(accurateCastOrNull(LogAttributes['latency_ms'], 'Float64'))",
    );
    expect(sql).toMatchSnapshot();
  });
});

describe('SLO query results', () => {
  it('parses 64-bit counts sent as strings', () => {
    expect(parseSloCountsRow([{ slo_eligible: '12', slo_good: '10' }])).toEqual(
      { eligible: 12, good: 10 },
    );
  });

  it('reads history buckets in time order', () => {
    expect(
      parseSloHistoryRows([
        {
          __hdx_time_bucket: '2026-11-01T01:00:00Z',
          slo_eligible: '5',
          slo_good: '4',
        },
        {
          __hdx_time_bucket: '2026-11-01T00:00:00Z',
          slo_eligible: '3',
          slo_good: '3',
        },
        { slo_eligible: '1', slo_good: '1' },
      ]),
    ).toEqual([
      { ts: Date.parse('2026-11-01T00:00:00Z'), eligible: 3, good: 3 },
      { ts: Date.parse('2026-11-01T01:00:00Z'), eligible: 5, good: 4 },
    ]);
  });

  it('sums the long and short burn windows from the buckets', () => {
    const end = new Date('2026-11-08T00:00:00Z');
    const bucket = (
      minutesBeforeEnd: number,
      eligible: number,
      good: number,
    ) => ({
      ts: end.getTime() - minutesBeforeEnd * 60_000,
      eligible,
      good,
    });
    const buckets = [
      bucket(360, 100, 100), // first bucket of 6h, outside 1h
      bucket(60, 10, 9), // first bucket of the last hour
      bucket(30, 10, 8),
      bucket(5, 10, 5), // last bucket
    ];
    expect(sumSloBuckets(buckets)).toEqual({ eligible: 130, good: 122 });
    expect(
      getSloBurnCounts(
        buckets,
        [
          { window: '1h', shortWindow: '5m' },
          { window: '6h', shortWindow: '30m' },
        ],
        end,
      ),
    ).toEqual([
      { eligible: 30, good: 22, shortEligible: 10, shortGood: 5 },
      { eligible: 130, good: 122, shortEligible: 20, shortGood: 13 },
    ]);
  });
});

describe('SLO group results', () => {
  it('reads counts per group in the query order', () => {
    expect(
      parseSloGroupRows([
        { slo_group: 'checkout', slo_eligible: '30', slo_good: '29' },
        { slo_group: 42, slo_eligible: '10', slo_good: '10' },
      ]),
    ).toEqual([
      { value: 'checkout', eligible: 30, good: 29 },
      { value: '42', eligible: 10, good: 10 },
    ]);
  });

  it('splits bucketed rows by group', () => {
    const byGroup = parseSloGroupHistoryRows([
      {
        slo_group: 'cart',
        __hdx_time_bucket: '2026-11-01T00:05:00Z',
        slo_eligible: '2',
        slo_good: '2',
      },
      {
        slo_group: 'checkout',
        __hdx_time_bucket: '2026-11-01T00:00:00Z',
        slo_eligible: '5',
        slo_good: '4',
      },
      {
        slo_group: 'cart',
        __hdx_time_bucket: '2026-11-01T00:00:00Z',
        slo_eligible: '3',
        slo_good: '3',
      },
    ]);
    expect([...byGroup.keys()]).toEqual(['cart', 'checkout']);
    expect(byGroup.get('cart')?.map(b => b.eligible)).toEqual([3, 2]);
  });

  it('reads the distinct group count', () => {
    expect(parseSloGroupCountRow([{ slo_group_count: '250' }])).toBe(250);
  });

  it("keys an alert's group state by expression and value", () => {
    const key = getSloGroupKey("ResourceAttributes['k8s.ns']", 'a:b');
    expect(key).toBe("ResourceAttributes['k8s.ns']:a:b");
    const slo = { groupBy: "ResourceAttributes['k8s.ns']" };
    expect(getSloGroupValue(slo, key)).toBe('a:b');
    expect(getSloGroupValue(slo, getSloGroupKey(slo.groupBy, ''))).toBe('');
    // Not one of this SLO's groups: ungrouped, or grouped by another one.
    expect(getSloGroupValue(slo, '')).toBeUndefined();
    expect(getSloGroupValue(slo, 'SpanName:GET')).toBeUndefined();
    expect(getSloGroupValue({ groupBy: null }, key)).toBeUndefined();
  });
});

describe('SLO bad events drill-down', () => {
  it('adds the bad condition to the eligible filters', () => {
    expect(buildSloBadEventsSearch(availability)).toEqual({
      where: "SpanKind = 'Server'",
      whereLanguage: 'sql',
      filters: [
        { type: 'sql', condition: "ServiceName IN ('checkout')" },
        { type: 'sql', condition: "NOT ifNull((StatusCode != 'Error'), 0)" },
      ],
    });
  });

  it('scopes the drill-down to one group', () => {
    expect(
      buildSloBadEventsSearch(
        { ...availability, groupBy: 'ServiceName' },
        undefined,
        'checkout',
      ).filters,
    ).toEqual([
      { type: 'sql', condition: "ServiceName IN ('checkout')" },
      { type: 'sql', condition: "toString(ServiceName) = 'checkout'" },
      { type: 'sql', condition: "NOT ifNull((StatusCode != 'Error'), 0)" },
    ]);
  });

  it('sorts latency SLOs slowest first and shows a cast duration', () => {
    const search = buildSloBadEventsSearch(logLatency, 'Timestamp, Body');
    expect(search.orderBy).toBe(
      "accurateCastOrNull(LogAttributes['latency_ms'], 'Float64') DESC",
    );
    expect(search.select).toBe(
      "Timestamp, Body, accurateCastOrNull(LogAttributes['latency_ms'], 'Float64') AS duration_ms",
    );
  });
});

describe('SLO schema', () => {
  const base = {
    name: 'Checkout availability',
    source: 'source-1',
    target: 99.9,
    window: '30d' as const,
  };

  it('requires a good condition unless the template is latency', () => {
    expect(
      SloInputSchema.safeParse({
        ...base,
        indicator: {
          template: 'availability',
          eligible: { where: '', whereLanguage: 'sql' },
        },
      }).success,
    ).toBe(false);
    expect(SloInputSchema.safeParse({ ...base, ...availability }).success).toBe(
      true,
    );
  });

  it('requires distinct channels for each alert that is on', () => {
    const withChannels = (rule: 'fastBurn' | 'slowBurn', ids: string[]) =>
      SloInputSchema.safeParse({
        ...base,
        ...availability,
        alerts: {
          [rule]: {
            channels: ids.map(webhookId => ({ type: 'webhook', webhookId })),
          },
        },
      }).success;
    for (const rule of ['fastBurn', 'slowBurn'] as const) {
      expect(withChannels(rule, [])).toBe(false);
      expect(withChannels(rule, [''])).toBe(false);
      expect(withChannels(rule, ['a', 'a'])).toBe(false);
      expect(withChannels(rule, ['a', 'b'])).toBe(true);
    }
    // No alerts at all.
    expect(SloInputSchema.parse({ ...base, ...availability }).alerts).toEqual(
      {},
    );
  });

  it('describes each burn alert in one sentence', () => {
    expect(describeSloAlertRule('fastBurn', '30d')).toBe(
      '2% of the 30-day error budget is spent within 1 hour (14.4x the allowed rate)',
    );
    // The same share of a shorter window's budget is a slower burn.
    expect(describeSloAlertRule('slowBurn', '7d')).toBe(
      '5% of the 7-day error budget is spent within 6 hours (1.4x the allowed rate)',
    );
    expect(describeSloAlertRule('slowBurn')).toBe(
      '5% of the error budget is spent within 6 hours',
    );
    expect(describeSloAlertRuleDetails('fastBurn')).toBe(
      'Resolves once the last 5 minutes burn slower than that. Needs at ' +
        'least 20 events in 1 hour. Checked every 5 minutes.',
    );
  });

  it('derives latency thresholds in the source unit', () => {
    expect(
      buildSloLatencyGoodSql({
        expression: 'Duration',
        unit: 'ns',
        thresholdMs: 250,
        numeric: true,
        requireDuration: true,
      }),
    ).toBe('(Duration) <= 250000000');
    expect(getSloDefaultDuration(traceSource)).toEqual({
      expression: 'Duration',
      unit: 'ns',
      numeric: true,
    });
  });
});
