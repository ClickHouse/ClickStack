import type { ClickHouseClient } from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
} from '@/types';

// Two instrumentation scopes in one process can report the same metric with
// the same resource, scope and point attributes. The OTel data model makes
// them two streams, so the metric queries must not merge them into one series.
describe('metric series from different scopes (integration)', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;
  let metadata: Metadata;

  const DATABASE = 'default';
  const GAUGE_TABLE = 'scope_name_gauge_int_test';
  const SUM_TABLE = 'scope_name_sum_int_test';
  const HIST_TABLE = 'scope_name_histogram_int_test';
  const EXP_HIST_TABLE = 'scope_name_exp_histogram_int_test';

  const SCOPE_A = 'scope.a';
  const SCOPE_B = 'scope.b';
  const MINUTES = [0, 1, 2];

  // Inserts are server-local strings; the CI ClickHouse runs in UTC.
  const insertTs = (minute: number) => `2025-04-15 10:0${minute}:00`;
  const bucket = (minute: number) => `2025-04-15T10:0${minute}:00Z`;

  // Columns of docker/otel-collector/schema/seed/00003_otel_metrics.sql that
  // every metric table shares.
  const COMMON_COLUMNS = `
    ResourceAttributes Map(LowCardinality(String), String),
    ResourceSchemaUrl String,
    ScopeName String,
    ScopeVersion String,
    ScopeAttributes Map(LowCardinality(String), String),
    ScopeDroppedAttrCount UInt32,
    ScopeSchemaUrl String,
    ServiceName LowCardinality(String),
    MetricName LowCardinality(String),
    MetricDescription String,
    MetricUnit String,
    Attributes Map(LowCardinality(String), String),
    StartTimeUnix DateTime,
    TimeUnix DateTime,
    Flags UInt32`;
  const ENGINE = `ENGINE = MergeTree PARTITION BY toDate(TimeUnix)
    ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)`;

  // Only ScopeName tells the two series apart.
  const commonFields = (metricName: string, minute: number, scope: string) => ({
    ResourceAttributes: { 'service.name': 'svc' },
    ResourceSchemaUrl: '',
    ScopeName: scope,
    ScopeVersion: '',
    ScopeAttributes: {},
    ScopeDroppedAttrCount: 0,
    ScopeSchemaUrl: '',
    ServiceName: 'svc',
    MetricName: metricName,
    MetricDescription: '',
    MetricUnit: '',
    Attributes: { 'http.route': '/api' },
    StartTimeUnix: insertTs(0),
    TimeUnix: insertTs(minute),
    Flags: 0,
  });

  const metricTables = {
    gauge: GAUGE_TABLE,
    sum: SUM_TABLE,
    histogram: HIST_TABLE,
    summary: 'unused',
    'exponential histogram': EXP_HIST_TABLE,
  };

  const queryRows = async (
    metricType: MetricsDataType,
    metricName: string,
    select: { aggFn: string; level?: number },
    groupBy?: string,
  ) => {
    const result = await hdxClient.queryChartConfig({
      config: {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables,
        from: { databaseName: DATABASE, tableName: '' },
        select: [
          {
            ...select,
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            alias: 'Value',
            metricName,
            metricType,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-04-14'), new Date('2025-04-16')],
        granularity: '1 minute',
        ...(groupBy ? { groupBy } : {}),
      } as ChartConfigWithOptDateRange,
      metadata,
      querySettings: undefined,
    });
    return result.data as Array<
      { __hdx_time_bucket: string; Value: unknown } & Record<string, unknown>
    >;
  };

  const runConfig = async (
    metricType: MetricsDataType,
    metricName: string,
    select: { aggFn: string; level?: number },
  ) =>
    new Map(
      (await queryRows(metricType, metricName, select)).map(row => [
        row.__hdx_time_bucket,
        Number(row.Value),
      ]),
    );

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });

    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${GAUGE_TABLE} (
        ${COMMON_COLUMNS},
        Value Float64
      ) ${ENGINE}`,
    });
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${SUM_TABLE} (
        ${COMMON_COLUMNS},
        Value Float64,
        AggregationTemporality Int32,
        IsMonotonic Bool
      ) ${ENGINE}`,
    });
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${HIST_TABLE} (
        ${COMMON_COLUMNS},
        Count UInt64,
        Sum Float64,
        BucketCounts Array(UInt64),
        ExplicitBounds Array(Float64),
        Min Float64,
        Max Float64,
        AggregationTemporality Int32
      ) ${ENGINE}`,
    });
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${EXP_HIST_TABLE} (
        ${COMMON_COLUMNS},
        Count UInt64,
        Sum Float64,
        Scale Int32,
        ZeroCount UInt64,
        PositiveOffset Int32,
        PositiveBucketCounts Array(UInt64),
        NegativeOffset Int32,
        NegativeBucketCounts Array(UInt64),
        Min Float64,
        Max Float64,
        AggregationTemporality Int32
      ) ${ENGINE}`,
    });

    // Both scopes report at the same time, as one SDK reader does.
    await client.insert({
      table: `${DATABASE}.${GAUGE_TABLE}`,
      values: MINUTES.flatMap(m => [
        { ...commonFields('gauge.cpu', m, SCOPE_A), Value: 10 },
        { ...commonFields('gauge.cpu', m, SCOPE_B), Value: 20 },
      ]),
      format: 'JSONEachRow',
    });

    // Cumulative counters: scope a stays at 1000, scope b goes up by 5 a
    // minute. sum.single has the scope b series only.
    const sumRow = (
      metricName: string,
      minute: number,
      scope: string,
      value: number,
    ) => ({
      ...commonFields(metricName, minute, scope),
      Value: value,
      AggregationTemporality: 2,
      IsMonotonic: true,
    });
    await client.insert({
      table: `${DATABASE}.${SUM_TABLE}`,
      values: MINUTES.flatMap(m => [
        sumRow('sum.requests', m, SCOPE_A, 1000),
        sumRow('sum.requests', m, SCOPE_B, 5 * m),
        sumRow('sum.single', m, SCOPE_B, 5 * m),
      ]),
      format: 'JSONEachRow',
    });

    // Cumulative histograms: scope a holds 1000 old observations in (0, 10],
    // scope b gets 5 new observations a minute in (10, 30].
    const histRow = (
      minute: number,
      scope: string,
      bucketCounts: number[],
    ) => ({
      ...commonFields('hist.latency', minute, scope),
      Count: bucketCounts.reduce((a, b) => a + b, 0),
      Sum: 0,
      BucketCounts: bucketCounts,
      ExplicitBounds: [10, 30],
      Min: 0,
      Max: 0,
      AggregationTemporality: 2,
    });
    await client.insert({
      table: `${DATABASE}.${HIST_TABLE}`,
      values: MINUTES.flatMap(m => [
        histRow(m, SCOPE_A, [1000, 0, 0]),
        histRow(m, SCOPE_B, [0, 5 * m, 0]),
      ]),
      format: 'JSONEachRow',
    });

    // Cumulative native histograms at scale 3, where bucket 8 is (2, 2.18]
    // and bucket 16 is (4, 4.36]: scope a holds 1000 old observations in
    // bucket 8, scope b gets 5 new observations a minute in bucket 16.
    const expHistRow = (
      minute: number,
      scope: string,
      offset: number,
      count: number,
    ) => ({
      ...commonFields('exphist.latency', minute, scope),
      Count: count,
      Sum: 0,
      Scale: 3,
      ZeroCount: 0,
      PositiveOffset: offset,
      PositiveBucketCounts: [count],
      NegativeOffset: 0,
      NegativeBucketCounts: [],
      Min: 0,
      Max: 0,
      AggregationTemporality: 2,
    });
    await client.insert({
      table: `${DATABASE}.${EXP_HIST_TABLE}`,
      values: MINUTES.flatMap(m => [
        expHistRow(m, SCOPE_A, 8, 1000),
        expHistRow(m, SCOPE_B, 16, 5 * m),
      ]),
      format: 'JSONEachRow',
    });
  });

  beforeEach(() => {
    metadata = new Metadata(hdxClient, new MetadataCache());
  });

  afterAll(async () => {
    for (const table of [GAUGE_TABLE, SUM_TABLE, HIST_TABLE, EXP_HIST_TABLE]) {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DATABASE}.${table}`,
      });
    }
    await hdxClient.close();
    await client.close();
  });

  it.each([
    ['sum', 30],
    ['count', 2],
  ])('reads a gauge %s over both scopes', async (aggFn, expected) => {
    const values = await runConfig(MetricsDataType.Gauge, 'gauge.cpu', {
      aggFn,
    });
    for (const m of MINUTES) {
      expect(values.get(bucket(m))).toBe(expected);
    }
  });

  it('gives each scope its own gauge group', async () => {
    const rows = await queryRows(
      MetricsDataType.Gauge,
      'gauge.cpu',
      { aggFn: 'sum' },
      'ScopeName',
    );
    const byScope = Object.fromEntries(
      rows
        .filter(row => row.__hdx_time_bucket === bucket(1))
        .map(row => [row.ScopeName, Number(row.Value)]),
    );
    expect(byScope).toEqual({ [SCOPE_A]: 10, [SCOPE_B]: 20 });
  });

  it('computes counter increase per scope', async () => {
    const values = await runConfig(MetricsDataType.Sum, 'sum.requests', {
      aggFn: 'increase',
    });
    expect(values.get(bucket(1))).toBe(5);
    expect(values.get(bucket(2))).toBe(5);
  });

  it('keeps the increase of a counter in one scope unchanged', async () => {
    const values = await runConfig(MetricsDataType.Sum, 'sum.single', {
      aggFn: 'increase',
    });
    expect(values.get(bucket(1))).toBe(5);
    expect(values.get(bucket(2))).toBe(5);
  });

  it('counts histogram observations per scope', async () => {
    const counts = await runConfig(MetricsDataType.Histogram, 'hist.latency', {
      aggFn: 'count',
    });
    expect(counts.get(bucket(1))).toBe(5);
    expect(counts.get(bucket(2))).toBe(5);
  });

  it('computes histogram quantiles from the new observations only', async () => {
    const p50 = await runConfig(MetricsDataType.Histogram, 'hist.latency', {
      aggFn: 'quantile',
      level: 0.5,
    });
    expect(p50.get(bucket(1))).toBeGreaterThan(10);
    expect(p50.get(bucket(1))).toBeLessThanOrEqual(30);
  });

  it('counts exponential histogram observations per scope', async () => {
    const counts = await runConfig(
      MetricsDataType.ExponentialHistogram,
      'exphist.latency',
      { aggFn: 'count' },
    );
    expect(counts.get(bucket(1))).toBe(5);
    expect(counts.get(bucket(2))).toBe(5);
  });

  it('computes exponential histogram quantiles from the new observations only', async () => {
    const p50 = await runConfig(
      MetricsDataType.ExponentialHistogram,
      'exphist.latency',
      { aggFn: 'quantile', level: 0.5 },
    );
    expect(p50.get(bucket(1))).toBeGreaterThan(4);
    expect(p50.get(bucket(1))).toBeLessThanOrEqual(2 ** (17 / 8));
  });
});
