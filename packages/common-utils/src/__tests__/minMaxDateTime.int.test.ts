import type { ClickHouseClient } from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

import { parameterizedQueryToSql } from '@/clickhouse';
import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import { ChartConfigWithOptDateRange, DisplayType } from '@/types';

describe('min/max on date and time columns (integration)', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;
  let metadata: Metadata;

  const DB = 'default';
  const TABLE = 'test_min_max_datetime';

  const baseConfig: ChartConfigWithOptDateRange = {
    displayType: DisplayType.Table,
    connection: 'test-connection',
    from: { databaseName: DB, tableName: TABLE },
    select: [],
    where: '',
    whereLanguage: 'sql',
    timestampValueExpression: 'Timestamp',
    dateRange: [new Date('2025-01-01'), new Date('2025-12-31')],
  };

  async function query(
    config: ChartConfigWithOptDateRange,
  ): Promise<Record<string, unknown>[]> {
    const sql = parameterizedQueryToSql(
      await renderChartConfig(config, metadata, undefined),
    );
    const result = await client.query({ query: sql, format: 'JSONEachRow' });
    return (await result.json()) as Record<string, unknown>[];
  }

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });

    await client.command({
      query: `
        CREATE OR REPLACE TABLE ${DB}.${TABLE} (
          Timestamp DateTime64(9),
          TimestampTime DateTime DEFAULT toDateTime(Timestamp),
          EventDate Date DEFAULT toDate(Timestamp),
          Duration UInt64,
          ServiceName LowCardinality(String),
          SampleRate UInt64,
          SpanAttributes Map(LowCardinality(String), String)
        )
        ENGINE = MergeTree()
        ORDER BY (Timestamp)
      `,
    });

    await client.command({
      query: `
        INSERT INTO ${DB}.${TABLE}
          (Timestamp, Duration, ServiceName, SampleRate, SpanAttributes)
        VALUES
          ('2025-06-01 00:00:01.123456789', 100, 'api', 1, map('http.status_code', '200')),
          ('2025-06-01 00:00:05', 300, 'api', 5, map('http.status_code', '500')),
          ('2025-06-02 10:00:00', 50, 'web', 1, map('http.status_code', '404')),
          ('2025-06-03 12:30:00.5', 200, 'web', 10, map('http.status_code', '201'))
      `,
    });
  });

  beforeEach(() => {
    metadata = new Metadata(hdxClient, new MetadataCache());
  });

  afterAll(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS ${DB}.${TABLE}` });
    await hdxClient.close();
    await client.close();
  });

  it('returns the earliest and latest DateTime64 timestamps, not 0', async () => {
    const [row] = await query({
      ...baseConfig,
      select: [
        { aggFn: 'min', valueExpression: 'Timestamp', alias: 'first_seen' },
        { aggFn: 'max', valueExpression: 'Timestamp', alias: 'last_seen' },
      ],
    });
    expect(row).toEqual({
      first_seen: '2025-06-01 00:00:01.123456789',
      last_seen: '2025-06-03 12:30:00.500000000',
    });
  });

  it('returns per-group timestamps for DateTime and Date columns', async () => {
    const rows = await query({
      ...baseConfig,
      select: [
        { aggFn: 'min', valueExpression: 'TimestampTime', alias: 'first_seen' },
        { aggFn: 'max', valueExpression: 'EventDate', alias: 'last_day' },
      ],
      groupBy: 'ServiceName',
      orderBy: 'ServiceName',
    });
    expect(rows).toEqual([
      {
        first_seen: '2025-06-01 00:00:01',
        last_day: '2025-06-01',
        ServiceName: 'api',
      },
      {
        first_seen: '2025-06-02 10:00:00',
        last_day: '2025-06-03',
        ServiceName: 'web',
      },
    ]);
  });

  it('returns timestamps in a single-series number tile', async () => {
    const [row] = await query({
      ...baseConfig,
      displayType: DisplayType.Number,
      select: [
        { aggFn: 'max', valueExpression: 'Timestamp', alias: 'last_seen' },
      ],
    });
    expect(row).toEqual({ last_seen: '2025-06-03 12:30:00.500000000' });
  });

  it('applies an aggCondition and sample weighting without losing the type', async () => {
    const [row] = await query({
      ...baseConfig,
      sampleWeightExpression: 'SampleRate',
      select: [
        {
          aggFn: 'max',
          valueExpression: 'Timestamp',
          aggCondition: "ServiceName = 'api'",
          aggConditionLanguage: 'sql',
          alias: 'api_last_seen',
        },
        { aggFn: 'min', valueExpression: 'Timestamp', alias: 'first_seen' },
      ],
    });
    expect(row).toEqual({
      api_last_seen: '2025-06-01 00:00:05.000000000',
      first_seen: '2025-06-01 00:00:01.123456789',
    });
  });

  it('still returns numbers for numeric columns and numeric-string attributes', async () => {
    const [row] = await query({
      ...baseConfig,
      select: [
        { aggFn: 'min', valueExpression: 'Duration', alias: 'min_duration' },
        { aggFn: 'max', valueExpression: 'Duration', alias: 'max_duration' },
        {
          aggFn: 'max',
          valueExpression: "SpanAttributes['http.status_code']",
          alias: 'max_status',
        },
      ],
    });
    expect(row).toEqual({
      min_duration: 50,
      max_duration: 300,
      max_status: 500,
    });
  });

  it('runs a ratio over max(Timestamp) without a ClickHouse type error', async () => {
    const rows = await query({
      ...baseConfig,
      seriesReturnType: 'ratio',
      select: [
        { aggFn: 'max', valueExpression: 'Timestamp' },
        { aggFn: 'count', valueExpression: '' },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(typeof Object.values(rows[0])[0]).toBe('number');
  });

  it('runs a formula over max(Timestamp) without a ClickHouse type error', async () => {
    const [row] = await query({
      ...baseConfig,
      formulas: [{ expression: 'A / B', alias: 'per_row' }],
      select: [
        { aggFn: 'max', valueExpression: 'Timestamp' },
        { aggFn: 'count', valueExpression: '' },
      ],
    });
    expect(typeof row.per_row).toBe('number');
  });
});
