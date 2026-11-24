import { parameterizedQueryToSql } from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  buildSloCountsChartConfig,
  buildSloGroupCountChartConfig,
  buildSloSourceTotalChartConfig,
  getSloGroupBy,
  getSloWindowRange,
  parseSloCountsRow,
  parseSloGroupCountRow,
  parseSloTotalRow,
} from '@hyperdx/common-utils/dist/core/slo';
import { computeSloStats } from '@hyperdx/common-utils/dist/core/sloStats';
import { SLO_MAX_GROUPS } from '@hyperdx/common-utils/dist/slo';
import mongoose from 'mongoose';

import { getSloQueryContext, runSloQuery } from '@/controllers/slo';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { formatZodIssues, mcpUserError } from '@/mcp/utils/errors';
import { getClickHouseErrorType } from '@/utils/clickhouseErrors';
import { BaseError } from '@/utils/errors';

import { mcpPreviewSloSchema, SloPreviewDefinitionSchema } from './schemas';

/** Bounds each preview query, as for one SLO's detail. */
const SLO_PREVIEW_TIMEOUT_MS = 30_000;

export function registerPreviewSlo({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_preview_slo',
    {
      title: 'Preview SLO',
      annotations: READ_ONLY_TOOL,
      description:
        'Dry run an SLO definition over its window without saving it, like ' +
        'the preview in the SLO builder: eligible, good and bad events, ' +
        'excluded events (in the source but not eligible), the SLI, the ' +
        'error budget left, the number of groups for a group-by, and the SQL ' +
        'of the counts query. Use it before clickstack_save_slo to check ' +
        'that the conditions select the events you expect.',
      inputSchema: mcpPreviewSloSchema,
    },
    async ({ definition }) => {
      const parsed = SloPreviewDefinitionSchema.safeParse(definition);
      if (!parsed.success) {
        return mcpUserError(
          `Invalid SLO definition:\n${formatZodIssues(parsed.error)}`,
        );
      }
      const slo = parsed.data;
      if (!mongoose.Types.ObjectId.isValid(slo.source)) {
        return mcpUserError('Invalid source ID');
      }
      try {
        const ctx = await getSloQueryContext(
          teamId,
          slo.source,
          SLO_PREVIEW_TIMEOUT_MS,
        );
        const { source } = ctx;
        const dateRange = getSloWindowRange(slo.window, new Date());
        const groupBy = getSloGroupBy(slo);
        const counts = buildSloCountsChartConfig({ slo, source, dateRange });
        const run = (config: Parameters<typeof runSloQuery>[1]) =>
          runSloQuery(ctx, config, SLO_PREVIEW_TIMEOUT_MS);
        const [countRows, totalRows, groupRows, sql] = await Promise.all([
          run(counts),
          run(buildSloSourceTotalChartConfig({ source, dateRange })),
          groupBy != null
            ? run(
                buildSloGroupCountChartConfig({
                  slo: { ...slo, groupBy },
                  source,
                  dateRange,
                }),
              )
            : undefined,
          renderChartConfig(counts, ctx.metadata, source.querySettings),
        ]);
        const stats = computeSloStats(
          parseSloCountsRow(countRows.rows),
          [],
          slo.target,
        );
        const groupCount =
          groupRows != null ? parseSloGroupCountRow(groupRows.rows) : null;
        const result = {
          windowStart: dateRange[0].toISOString(),
          windowEnd: dateRange[1].toISOString(),
          eligible: stats.eligible,
          good: stats.good,
          bad: stats.bad,
          excluded: Math.max(
            0,
            parseSloTotalRow(totalRows.rows) - stats.eligible,
          ),
          sli: stats.sli,
          budgetRemaining: stats.budgetRemaining,
          ...(groupCount != null
            ? {
                groupCount,
                trackedGroups: Math.min(groupCount, SLO_MAX_GROUPS),
              }
            : {}),
          sql: parameterizedQueryToSql(sql),
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (e) {
        // A missing source or connection, or a condition ClickHouse rejects,
        // is the caller's to fix.
        if (e instanceof BaseError) return mcpUserError(e.name);
        if (getClickHouseErrorType(e) != null && e instanceof Error) {
          return mcpUserError(`The SLO's query failed: ${e.message}`);
        }
        throw e;
      }
    },
  );
}
