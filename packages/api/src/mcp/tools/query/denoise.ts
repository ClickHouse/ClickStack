import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import {
  buildNoisyBodyMatcher,
  DENOISE_SAMPLE_SIZE,
  minePatterns,
  selectNoisyPatterns,
} from '@hyperdx/common-utils/dist/drain';
import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { MCP_QUERY_MAX_EXECUTION_SEC } from '@/mcp/utils/timeout';

import { resolveBodyExpression } from './helpers';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DenoiseResult {
  /** Filtered rows with noisy patterns removed. */
  rows: Record<string, unknown>[];
  /** Patterns that were identified as noisy and removed. */
  removedPatterns: Array<{
    pattern: string;
    estimatedCount: number;
    sampleCount: number;
  }>;
  /**
   * When non-null, denoising was skipped and rows are returned unmodified.
   * The value describes why (e.g. "body_column_not_in_results").
   */
  skipped?: string;
}

// ─── Core denoising function ─────────────────────────────────────────────────

/**
 * Denoise search results by mining patterns from a random sample, identifying
 * "noisy" patterns (those accounting for >5% of the sample), and filtering
 * them out of the result rows.
 *
 * This mirrors the web app's "Denoise Results" feature
 * (packages/app/src/components/DBRowTable.tsx) but runs server-side using
 * the shared TypeScript Drain implementation.
 */
export async function denoiseSearchResults(
  teamId: string,
  sourceId: string,
  startDate: Date,
  endDate: Date,
  rows: Record<string, unknown>[],
  options?: {
    where?: string;
    whereLanguage?: 'lucene' | 'sql';
  },
): Promise<DenoiseResult> {
  if (rows.length === 0) {
    return { rows, removedPatterns: [], skipped: 'no_rows' };
  }

  // ── Resolve source & connection ──
  const source = await getSource(teamId, sourceId);
  if (!source) {
    return { rows, removedPatterns: [], skipped: 'source_not_found' };
  }

  const bodyColumn = resolveBodyExpression(source);
  if (!bodyColumn) {
    return { rows, removedPatterns: [], skipped: 'no_body_column' };
  }

  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    return { rows, removedPatterns: [], skipped: 'connection_not_found' };
  }

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });
  const metadata = getMetadata(clickhouseClient);

  const tsExpr = getFirstTimestampValueExpression(
    source.timestampValueExpression,
  );
  const implicitColumn =
    'implicitColumnExpression' in source
      ? source.implicitColumnExpression
      : undefined;
  const useTextIndexForImplicitColumn =
    'useTextIndexForImplicitColumn' in source
      ? source.useTextIndexForImplicitColumn
      : undefined;

  // ── Query: Random sample of events for pattern learning ──
  const sampleConfig = {
    displayType: DisplayType.Search,
    source: source._id.toString(),
    select: `${bodyColumn} as __hdx_pattern_body, ${tsExpr} as __hdx_pattern_ts`,
    from: {
      databaseName: source.from.databaseName,
      tableName: source.from.tableName,
    },
    where: options?.where ?? '',
    whereLanguage: options?.whereLanguage ?? ('lucene' as const),
    connection: source.connection.toString(),
    timestampValueExpression: source.timestampValueExpression,
    implicitColumnExpression: implicitColumn,
    useTextIndexForImplicitColumn,
    orderBy: [{ ordering: 'DESC' as const, valueExpression: 'rand()' }],
    limit: { limit: DENOISE_SAMPLE_SIZE, offset: 0 },
    dateRange: [startDate, endDate] as [Date, Date],
  } satisfies ChartConfigWithDateRange;

  // ── Query: Total count for sample multiplier ──
  const countConfig = {
    displayType: DisplayType.Table,
    source: source._id.toString(),
    select: 'count() as total',
    from: {
      databaseName: source.from.databaseName,
      tableName: source.from.tableName,
    },
    where: options?.where ?? '',
    whereLanguage: options?.whereLanguage ?? ('lucene' as const),
    connection: source.connection.toString(),
    timestampValueExpression: source.timestampValueExpression,
    implicitColumnExpression: implicitColumn,
    useTextIndexForImplicitColumn,
    limit: { limit: 1, offset: 0 },
    dateRange: [startDate, endDate] as [Date, Date],
  } satisfies ChartConfigWithDateRange;

  let sampleResult: Awaited<
    ReturnType<typeof clickhouseClient.queryChartConfig>
  >;
  let countResult: Awaited<
    ReturnType<typeof clickhouseClient.queryChartConfig>
  >;
  try {
    [sampleResult, countResult] = await Promise.all([
      clickhouseClient.queryChartConfig({
        config: sampleConfig,
        metadata,
        querySettings: source.querySettings,
        opts: {
          clickhouse_settings: {
            max_execution_time: MCP_QUERY_MAX_EXECUTION_SEC,
          },
        },
      }),
      clickhouseClient.queryChartConfig({
        config: countConfig,
        metadata,
        querySettings: source.querySettings,
        opts: {
          clickhouse_settings: {
            max_execution_time: MCP_QUERY_MAX_EXECUTION_SEC,
          },
        },
      }),
    ]);
  } catch {
    // If sampling fails, return rows unmodified rather than failing the search
    return { rows, removedPatterns: [], skipped: 'sampling_failed' };
  }

  const sampleRows = sampleResult.data;
  const totalCount = Number(countResult.data?.[0]?.total ?? 0);

  if (!sampleRows || sampleRows.length === 0) {
    return { rows, removedPatterns: [], skipped: 'no_sample_data' };
  }

  // ── Mine patterns from the sample ──
  // Note: maxSamples: 1 — minePatterns always keeps at least one sample per
  // cluster internally; we just minimize memory overhead.
  const { patterns } = minePatterns(sampleRows, {
    totalCount,
    startDate,
    endDate,
    maxSamples: 1,
    getBody: row => {
      const raw = row.__hdx_pattern_body;
      return raw != null ? String(raw) : '';
    },
    getTimestamp: row => {
      const tsRaw = row.__hdx_pattern_ts;
      return tsRaw != null ? new Date(String(tsRaw)).getTime() : null;
    },
  });

  if (patterns.length === 0) {
    return { rows, removedPatterns: [] };
  }

  const noisy = selectNoisyPatterns(
    patterns,
    p => p.sampleCount,
    sampleRows.length,
  );
  const noisyTemplates = new Set(noisy.map(p => p.pattern));
  const removedPatterns: DenoiseResult['removedPatterns'] = noisy.map(p => ({
    pattern: p.pattern,
    estimatedCount: p.estimatedCount,
    sampleCount: p.sampleCount,
  }));

  if (noisyTemplates.size === 0) {
    return { rows, removedPatterns: [] };
  }

  const bodyColumnKey = findBodyColumnKey(rows[0], bodyColumn);
  if (!bodyColumnKey) {
    return {
      rows,
      removedPatterns: [],
      skipped: 'body_column_not_in_results',
    };
  }

  const isNoisy = buildNoisyBodyMatcher(
    patterns.map(p => p.pattern),
    noisyTemplates,
  );
  const filteredRows = rows.filter(row => {
    const bodyValue = row[bodyColumnKey];
    if (bodyValue == null) return true; // Keep rows with no body
    return !isNoisy(String(bodyValue));
  });

  return {
    rows: filteredRows,
    removedPatterns,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find the key in a result row that corresponds to the body column expression.
 * ClickHouse may return the column under its expression name or a simplified alias.
 */
function findBodyColumnKey(
  row: Record<string, unknown>,
  bodyColumn: string,
): string | null {
  // Direct match (e.g. "Body", "SpanName")
  if (bodyColumn in row) return bodyColumn;

  // Case-insensitive match
  const lowerBody = bodyColumn.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lowerBody) return key;
  }

  return null;
}
