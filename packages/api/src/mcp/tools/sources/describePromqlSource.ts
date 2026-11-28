import { getQueryCost } from '@hyperdx/common-utils/dist/clickhouse/node';
import { quoteIdentifierIfNeeded } from '@hyperdx/common-utils/dist/core/metadata';

import { getPromqlLabelCatalog } from '@/controllers/promql';
import type { McpContext, ToolResult } from '@/mcp/tools/types';
import { getMcpConnection } from '@/mcp/utils/connections';
import { PROMQL_QUERY_USAGE, timeSeriesSqlUsage } from '@/mcp/utils/promql';
import logger from '@/utils/logger';

// A Prometheus endpoint lists names seen in this window; a ClickHouse table
// lists every name it holds.
const LABEL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_LABEL_NAMES = 100;
const MAX_METRIC_NAMES = 200;

/**
 * describe_source for a PromQL source: its metric names and label names
 * instead of a column schema, from either a ClickHouse TimeSeries table or a
 * Prometheus-compatible endpoint. With `metricName`, the label names are that
 * metric's.
 */
export async function describePromqlSource({
  context,
  source,
  metricName,
  meta,
  signal,
  progress,
}: {
  context: McpContext;
  metricName?: string;
  source: Parameters<typeof getPromqlLabelCatalog>[0]['source'];
  meta: Record<string, unknown>;
  signal: AbortSignal;
  /** Same contract as describe_source's: snapshot answers a stuck lookup. */
  progress: { snapshot?: () => ToolResult; partial?: boolean };
}): Promise<ToolResult> {
  const partialResult = (error: string) =>
    toResult({ source: meta, partial: true, error });

  // The lookup may outlive the tool's deadline (the tags-table column check
  // ignores the signal), so the config is answerable from the start.
  progress.snapshot = () =>
    partialResult('Listing labels timed out before it finished.');

  const endMs = Date.now();
  try {
    const catalog = await getPromqlLabelCatalog({
      teamId: context.teamId,
      source,
      startMs: endMs - LABEL_LOOKBACK_MS,
      endMs,
      metricName,
      limit: Math.max(MAX_LABEL_NAMES, MAX_METRIC_NAMES),
      signal,
      getConnection: (connectionId, options) =>
        getMcpConnection(context, connectionId, options),
    });
    const { labelNames, metricNames } = catalog;
    const truncated =
      (labelNames?.length ?? 0) > MAX_LABEL_NAMES ||
      metricNames.length > MAX_METRIC_NAMES;
    const notes = [
      ...(truncated
        ? [
            `Lists are capped at ${MAX_LABEL_NAMES} label names and ${MAX_METRIC_NAMES} metric names.`,
          ]
        : []),
      ...(catalog.backend === 'clickhouse'
        ? [
            'Names come from every series the table holds, including series with no recent samples.',
          ]
        : []),
      ...(labelNames == null
        ? ['Pass metricName to list the label names of one metric.']
        : []),
      // A metric's label names always include __name__. A Prometheus endpoint
      // only looks at the lookback window, so there it may just be idle.
      ...(metricName != null && labelNames?.length === 0
        ? [
            catalog.backend === 'clickhouse'
              ? `No series has the metric name ${JSON.stringify(metricName)}.`
              : `No series with the metric name ${JSON.stringify(metricName)} had samples in the last 24 hours.`,
          ]
        : []),
    ];
    const table =
      catalog.backend === 'clickhouse'
        ? `${quoteIdentifierIfNeeded(source.from.databaseName)}.${quoteIdentifierIfNeeded(source.from.tableName)}`
        : undefined;
    return toResult(
      {
        source: {
          ...meta,
          backend: catalog.backend,
          ...(table ? { table } : {}),
        },
        ...(labelNames
          ? { labelNames: labelNames.slice(0, MAX_LABEL_NAMES) }
          : {}),
        metricNames: metricNames.slice(0, MAX_METRIC_NAMES),
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      },
      table && timeSeriesSqlUsage(table),
    );
  } catch (e) {
    logger.warn(
      { teamId: context.teamId, error: e },
      'Failed to list labels for a PromQL source',
    );
    progress.partial = true;
    return partialResult(
      `Could not list labels: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function toResult(
  output: Record<string, unknown>,
  sqlUsage?: string,
): ToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            ...output,
            nextSteps: {
              query: PROMQL_QUERY_USAGE,
              ...(sqlUsage ? { sql: sqlUsage } : {}),
            },
            statistics: getQueryCost(),
          },
          null,
          2,
        ),
      },
    ],
  };
}
