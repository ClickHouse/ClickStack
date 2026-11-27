import type { ClickHouseClient } from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

import { parameterizedQueryToSql } from '@/clickhouse';
import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { tryOptimizeConfigWithMaterializedViewWithExplanations } from '@/core/materializedViews';
import { Metadata, MetadataCache } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import {
  BuilderChartConfigWithOptDateRange,
  DisplayType,
  SourceKind,
  TTraceSource,
} from '@/types';

// Percentiles read from a materialized view have to match the raw table
// whichever quantile sketch the view stores. Sketches built with an accuracy
// (DDSketch, GK) only merge correctly when the merge is given that accuracy
// ahead of the level.
describe('materialized view quantile sketches (integration)', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;
  let metadata: Metadata;

  const DB = 'default';
  const SPANS_TABLE = 'test_mv_sketch_spans';
  const SKETCHES = [
    { name: 'quantileDD', params: '0.01, 0.5', tolerance: 0.01 },
    { name: 'quantileGK', params: '1000, 0.5', tolerance: 0.01 },
    { name: 'quantileTDigest', params: '0.5', tolerance: 0.02 },
    { name: 'quantileBFloat16', params: '0.5', tolerance: 0.01 },
  ];
  const rollupTable = (sketch: string) => `test_mv_sketch_rollup_${sketch}`;

  const sourceFor = (sketch: string) =>
    ({
      id: 'test-traces',
      kind: SourceKind.Trace,
      name: 'Traces',
      connection: 'test-connection',
      from: { databaseName: DB, tableName: SPANS_TABLE },
      timestampValueExpression: 'Timestamp',
      durationExpression: 'Duration',
      materializedViews: [
        {
          databaseName: DB,
          tableName: rollupTable(sketch),
          dimensionColumns: 'ServiceName',
          minGranularity: '1 minute',
          timestampColumn: 'Timestamp',
          aggregatedColumns: [
            { aggFn: 'count', mvColumn: 'count', sourceColumn: '' },
            {
              aggFn: 'quantile',
              mvColumn: 'quantile__Duration',
              sourceColumn: 'Duration',
            },
          ],
        },
      ],
    }) as TTraceSource;

  // Five-minute buckets, so each bucket merges five one-minute sketch states.
  const percentileConfig = (
    level: number,
  ): BuilderChartConfigWithOptDateRange => ({
    displayType: DisplayType.Line,
    connection: 'test-connection',
    from: { databaseName: DB, tableName: SPANS_TABLE },
    select: [
      {
        alias: 'percentile',
        aggFn: 'quantile',
        level,
        valueExpression: 'Duration',
        aggCondition: '',
      },
    ],
    where: '',
    whereLanguage: 'sql',
    timestampValueExpression: 'Timestamp',
    dateRange: [
      new Date('2025-06-01T00:00:00Z'),
      new Date('2025-06-01T00:10:00Z'),
    ],
    granularity: '5 minute',
  });

  async function queryRows(sql: string) {
    const result = await client.query({ query: sql, format: 'JSONEachRow' });
    return (await result.json()) as Record<string, string>[];
  }

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });

    await client.command({
      query: `
        CREATE OR REPLACE TABLE ${DB}.${SPANS_TABLE} (
          Timestamp DateTime64(9),
          ServiceName LowCardinality(String),
          Duration UInt64
        )
        ENGINE = MergeTree()
        ORDER BY (Timestamp)
      `,
    });
    // 100,000 spans over ten minutes. Durations from 1 microsecond to
    // 100 milliseconds are permuted across the spans, so every minute holds
    // a spread of the whole range.
    await client.command({
      query: `
        INSERT INTO ${DB}.${SPANS_TABLE}
        SELECT
          toDateTime64('2025-06-01 00:00:00', 9, 'UTC') + toIntervalMillisecond(number * 6),
          'api',
          ((number * 7919) % 100000 + 1) * 1000
        FROM numbers(100000)
      `,
    });

    for (const { name, params } of SKETCHES) {
      await client.command({
        query: `
          CREATE OR REPLACE TABLE ${DB}.${rollupTable(name)} (
            Timestamp DateTime,
            ServiceName LowCardinality(String),
            count SimpleAggregateFunction(sum, UInt64),
            quantile__Duration AggregateFunction(${name}(${params}), UInt64)
          )
          ENGINE = AggregatingMergeTree()
          ORDER BY (Timestamp, ServiceName)
        `,
      });
      await client.command({
        query: `
          INSERT INTO ${DB}.${rollupTable(name)}
          SELECT
            toStartOfMinute(Timestamp) AS Timestamp,
            ServiceName,
            count() AS count,
            ${name}State(${params})(Duration) AS quantile__Duration
          FROM ${DB}.${SPANS_TABLE}
          GROUP BY Timestamp, ServiceName
        `,
      });
    }
  });

  beforeEach(() => {
    metadata = new Metadata(hdxClient, new MetadataCache());
  });

  afterAll(async () => {
    for (const { name } of SKETCHES) {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DB}.${rollupTable(name)}`,
      });
    }
    await client.command({
      query: `DROP TABLE IF EXISTS ${DB}.${SPANS_TABLE}`,
    });
    await hdxClient.close();
    await client.close();
  });

  it.each(SKETCHES)(
    'reads p95 and p99 from a $name rollup within its error of the raw table',
    async ({ name, tolerance }) => {
      for (const level of [0.95, 0.99]) {
        const { optimizedConfig, explanations } =
          await tryOptimizeConfigWithMaterializedViewWithExplanations(
            percentileConfig(level),
            metadata,
            hdxClient,
            undefined,
            sourceFor(name),
          );
        if (optimizedConfig == null) {
          throw new Error(
            `The ${name} rollup wasn't used: ${JSON.stringify(explanations)}`,
          );
        }
        expect(optimizedConfig.from.tableName).toBe(rollupTable(name));

        const rollupRows = await queryRows(
          parameterizedQueryToSql(
            await renderChartConfig(optimizedConfig, metadata, undefined),
          ),
        );
        const exactRows = await queryRows(`
          SELECT
            toStartOfInterval(toDateTime(Timestamp), INTERVAL 5 MINUTE) AS __hdx_time_bucket,
            quantileExact(${level})(Duration) AS percentile
          FROM ${DB}.${SPANS_TABLE}
          GROUP BY __hdx_time_bucket
        `);
        const exactByBucket = new Map(
          exactRows.map(row => [row.__hdx_time_bucket, Number(row.percentile)]),
        );

        expect(rollupRows).toHaveLength(2);
        for (const row of rollupRows) {
          const exact = exactByBucket.get(row.__hdx_time_bucket);
          expect(exact).toBeDefined();
          const relativeError =
            Math.abs(Number(row.percentile) - (exact ?? 0)) / (exact ?? 1);
          expect(relativeError).toBeLessThanOrEqual(tolerance);
        }
      }
    },
  );
});
