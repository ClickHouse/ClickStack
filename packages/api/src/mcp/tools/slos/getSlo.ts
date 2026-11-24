import {
  buildSloBadEventsSearch,
  getSloGroupBy,
} from '@hyperdx/common-utils/dist/core/slo';
import { describeFilter } from '@hyperdx/common-utils/dist/filters';
import { SloStateSchema } from '@hyperdx/common-utils/dist/slo';
import { isLogSource, isTraceSource } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod/v3';

import * as config from '@/config';
import {
  formatSlo,
  getSlo,
  getSloQueryContext,
  listSlos,
  SloQueryContext,
} from '@/controllers/slo';
import { getSloAlerts } from '@/controllers/sloAlert';
import { computeSloStatusNow } from '@/controllers/sloStatus';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import { andSql, userWhereAsSql } from '@/mcp/tools/query/patternDrilldown';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError, validateObjectId } from '@/mcp/utils/errors';
import type { ISlo } from '@/models/slo';
import { BaseError } from '@/utils/errors';

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

/**
 * Bounds the status computed for one SLO and the metadata reads that render
 * its bad-events where clause.
 */
const SLO_DETAIL_TIMEOUT_MS = 30_000;

/**
 * The SLO's bad events as one SQL where clause: the eligible where clause
 * and filters, rendered to SQL where they are Lucene, and the bad condition.
 * clickstack_search takes a single where clause, so this is what it can run.
 */
async function getBadEventsWhere(
  slo: ISlo,
  ctx: SloQueryContext,
  group: string | undefined,
) {
  const { source } = ctx;
  const search = buildSloBadEventsSearch(slo, undefined, group);
  const toSql = (where: string, whereLanguage: 'lucene' | 'sql') =>
    userWhereAsSql({
      where,
      whereLanguage,
      metadata: ctx.metadata,
      databaseName: source.from.databaseName,
      tableName: source.from.tableName,
      connectionId: source.connection.toString(),
      implicitColumnExpression:
        isLogSource(source) || isTraceSource(source)
          ? source.implicitColumnExpression
          : undefined,
      bodyExpression: isLogSource(source) ? source.bodyExpression : undefined,
    });
  const parts = await Promise.all([
    toSql(search.where, search.whereLanguage),
    ...search.filters.map(filter =>
      filter.type === 'lucene'
        ? toSql(filter.condition, 'lucene')
        : describeFilter(filter),
    ),
  ]);
  return andSql(...parts);
}

export function registerGetSlo({ context, registerTool }: ToolRegistrar): void {
  const { teamId } = context;
  const frontendUrl = config.FRONTEND_URL;

  registerTool(
    'clickstack_get_slo',
    {
      title: 'Get SLO(s)',
      annotations: READ_ONLY_TOOL,
      description:
        'Without an ID: list service level objectives as a summary (id, ' +
        'name, tags, target, window, group-by expression, state, SLI, ' +
        'error budget left, burn rate, alert states) from the status stored ' +
        'in the background (burn rate every few minutes, SLI and budget ' +
        'every 30 minutes; null until the first update). Optionally filter ' +
        'by state (e.g. state="burning"). With an ID: get the full ' +
        'definition, the status computed now (statusSource "live", or ' +
        '"stored" if computing it failed), and badEventsWhere, a SQL where ' +
        'clause that selects the bad events: pass it to clickstack_search ' +
        'with whereLanguage "sql" and the source of the SLO. A grouped SLO ' +
        '(groupBy set) has numbers for each of its busiest groups in ' +
        'status.groups, worst first, and takes the state of its worst ' +
        'group; status.groupCount counts all groups. Pass group to scope ' +
        'badEventsWhere to one group.',
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            'SLO ID from a previous list call. Omit to list all SLOs, ' +
              'provide to get full detail.',
          ),
        state: SloStateSchema.optional().describe(
          'List only SLOs currently in this state; ignored when id is ' +
            'provided. Use breached or burning to find SLOs that need ' +
            'attention.',
        ),
        group: z
          .string()
          .optional()
          .describe(
            'With an id of a grouped SLO: a value of its groupBy ' +
              'expression, as in status.groups[].value. Scopes ' +
              'badEventsWhere and the url to that group.',
          ),
      }),
    },
    async ({ id, state, group }) => {
      if (!id) {
        const slos = await listSlos(teamId);
        const alerts = await getSloAlerts(
          teamId,
          slos.map(slo => slo._id),
        );
        return json(
          slos
            .map(slo => formatSlo(slo, alerts.get(slo._id.toString())))
            .filter(slo => !state || slo.status?.state === state)
            .map(slo => ({
              id: slo.id,
              name: slo.name,
              tags: slo.tags,
              target: slo.target,
              window: slo.window,
              // Null when the SLO is not grouped.
              groupBy: slo.groupBy,
              state: slo.status?.state ?? null,
              sli: slo.status?.sli ?? null,
              budgetRemaining: slo.status?.budgetRemaining ?? null,
              burnRate: slo.status?.burn[0]?.burnRate ?? null,
              // Each burn alert's state, or null when it is off.
              alertStates: {
                fastBurn: slo.alertStates.fastBurn?.state ?? null,
                slowBurn: slo.alertStates.slowBurn?.state ?? null,
              },
            })),
        );
      }

      const idError = validateObjectId(id, 'SLO ID');
      if (idError) return idError;
      const slo = await getSlo(teamId, id);
      if (!slo) return mcpUserError('SLO not found');
      if (group != null && getSloGroupBy(slo) == null) {
        return mcpUserError('This SLO is not grouped; omit group');
      }
      const alert = (await getSloAlerts(teamId, [slo._id])).get(id);
      let ctx: SloQueryContext;
      try {
        ctx = await getSloQueryContext(
          teamId,
          slo.source.toString(),
          SLO_DETAIL_TIMEOUT_MS,
        );
      } catch (e) {
        // A deleted source or connection is the caller's to fix.
        if (e instanceof BaseError) return mcpUserError(e.name);
        throw e;
      }
      const formatted = formatSlo(slo, alert);
      // The stored snapshot stands in when the query fails or times out.
      const live = await computeSloStatusNow(slo, ctx).catch(() => null);
      return json({
        ...formatted,
        status: live ?? formatted.status,
        statusSource: live ? 'live' : 'stored',
        badEventsWhere: await getBadEventsWhere(slo, ctx, group),
        ...(frontendUrl
          ? {
              url:
                `${frontendUrl}/slos/${id}` +
                (group != null
                  ? `?${new URLSearchParams({ group }).toString()}`
                  : ''),
            }
          : {}),
      });
    },
  );
}
