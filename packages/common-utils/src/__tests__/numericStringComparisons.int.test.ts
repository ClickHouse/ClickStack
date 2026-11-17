import { ClickHouseClient, createClient } from '@clickhouse/client';

import { parameterizedQueryToSql } from '@/clickhouse';
import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import { ChartConfigWithOptDateRange } from '@/types';

// Unit tests only compare SQL text, which is how ranges with numeric bounds on
// String attributes shipped while ClickHouse rejected them. These run each
// search against ClickHouse and check which rows come back.
describe('numeric range bounds on String attributes', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;
  let metadata: Metadata;

  const DATABASE = 'default';
  const TABLE_NAME = 'numeric_string_comparisons_int_test';

  // Code mirrors gc_pause_ms in a FixedString, padded with zero bytes.
  const ROWS: Array<{
    Id: number;
    Severity: string;
    LogAttributes: Record<string, string>;
    Code: string;
  }> = [
    {
      Id: 1,
      Severity: 'debug',
      LogAttributes: { gc_pause_ms: '5' },
      Code: '5',
    },
    {
      Id: 2,
      Severity: 'info',
      LogAttributes: { gc_pause_ms: '10' },
      Code: '10',
    },
    {
      Id: 3,
      Severity: 'error',
      LogAttributes: { gc_pause_ms: '17.25' },
      Code: '17.25',
    },
    {
      Id: 4,
      Severity: 'info',
      LogAttributes: { gc_pause_ms: '100' },
      Code: '100',
    },
    {
      Id: 5,
      Severity: 'info',
      LogAttributes: { gc_pause_ms: '150' },
      Code: '150',
    },
    {
      Id: 6,
      Severity: 'info',
      LogAttributes: { gc_pause_ms: 'abc' },
      Code: 'abc',
    },
    { Id: 7, Severity: 'info', LogAttributes: { other: 'x' }, Code: '' },
  ];

  const queryIds = async (where: string) => {
    const config: ChartConfigWithOptDateRange = {
      connection: 'test-connection',
      from: { databaseName: DATABASE, tableName: TABLE_NAME },
      select: 'Id',
      where,
      whereLanguage: 'lucene',
      timestampValueExpression: 'Timestamp',
      dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
      orderBy: 'Id',
    };
    const sql = parameterizedQueryToSql(
      await renderChartConfig(config, metadata, undefined),
    );
    const result = await client.query({ query: sql, format: 'JSONEachRow' });
    const rows = await result.json<{ Id: number }>();
    return rows.map(r => Number(r.Id));
  };

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });

    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${TABLE_NAME} (
        Timestamp DateTime64(9),
        Id UInt32,
        Severity Enum8('debug' = 1, 'info' = 5, 'error' = 9),
        LogAttributes Map(LowCardinality(String), String),
        GcPause String MATERIALIZED LogAttributes['gc_pause_ms'],
        Code FixedString(8)
      )
      ENGINE = MergeTree
      ORDER BY (Timestamp)`,
    });

    await client.insert({
      table: `${DATABASE}.${TABLE_NAME}`,
      values: ROWS.map(r => ({ ...r, Timestamp: '2025-01-01 12:00:00' })),
      format: 'JSONEachRow',
    });
  });

  beforeEach(() => {
    metadata = new Metadata(hdxClient, new MetadataCache());
  });

  afterAll(async () => {
    await client.command({
      query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE_NAME}`,
    });
    await hdxClient.close();
    await client.close();
  });

  it.each([
    ['LogAttributes.gc_pause_ms:[10 TO 100]', [2, 3, 4]],
    ['LogAttributes.gc_pause_ms:{10 TO 100}', [3]],
    ['LogAttributes.gc_pause_ms:[100 TO *]', [4, 5]],
    // Missing (7) and non-numeric (6) values match a negated range.
    ['-LogAttributes.gc_pause_ms:[10 TO 100]', [1, 5, 6, 7]],
    // Comparisons stay lexical: '5', '17.25' and 'abc' sort after '100'.
    ['LogAttributes.gc_pause_ms:>100', [1, 3, 5, 6]],
    // A materialized String column and a FixedString compare the same way.
    ['GcPause:[10 TO 100]', [2, 3, 4]],
    ['Code:[10 TO 100]', [2, 3, 4]],
    // Enum columns keep comparing by their numeric value.
    ['Severity:[1 TO 5]', [1, 2, 4, 5, 6, 7]],
  ])('%s returns the matching rows', async (where, ids) => {
    expect(await queryIds(where)).toEqual(ids);
  });
});
