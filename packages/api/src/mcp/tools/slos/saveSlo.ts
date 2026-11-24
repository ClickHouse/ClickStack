import { SloInputSchema } from '@hyperdx/common-utils/dist/slo';
import mongoose from 'mongoose';

import * as config from '@/config';
import { createSlo, updateSlo } from '@/controllers/slo';
import { OPEN_WORLD_UPSERT_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { formatZodPath } from '@/mcp/utils/errors';
import { BaseError } from '@/utils/errors';
import logger from '@/utils/logger';

import { mcpSaveSloSchema } from './schemas';

type SaveResult =
  | { index: number; ok: true; id: string; url?: string }
  | {
      index: number;
      ok: false;
      error: string;
      issues?: { path: string; message: string }[];
    };

export function registerSaveSlo({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId, userId } = context;
  const frontendUrl = config.FRONTEND_URL;

  /** Validates and saves one SLO; never throws, so the batch goes on. */
  const saveOne = async (
    index: number,
    item: Record<string, unknown>,
  ): Promise<SaveResult> => {
    const { id, ...definition } = item;
    if (
      id != null &&
      (typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id))
    ) {
      return { index, ok: false, error: 'Invalid SLO ID' };
    }
    const parsed = SloInputSchema.safeParse(definition);
    if (!parsed.success) {
      return {
        index,
        ok: false,
        error: 'Invalid SLO definition',
        issues: parsed.error.errors.map(issue => ({
          path: formatZodPath(issue.path),
          message: issue.message,
        })),
      };
    }
    if (!mongoose.Types.ObjectId.isValid(parsed.data.source)) {
      return {
        index,
        ok: false,
        error: 'Invalid SLO definition',
        issues: [{ path: 'source', message: 'Invalid source ID' }],
      };
    }
    try {
      const saved =
        typeof id === 'string'
          ? await updateSlo(teamId, id, userId, parsed.data)
          : await createSlo(teamId, userId, parsed.data);
      if (!saved) return { index, ok: false, error: 'SLO not found' };
      const savedId = saved._id.toString();
      return {
        index,
        ok: true,
        id: savedId,
        ...(frontendUrl ? { url: `${frontendUrl}/slos/${savedId}` } : {}),
      };
    } catch (e) {
      // Api400Error and the other BaseErrors keep their message in `name`.
      if (e instanceof BaseError) return { index, ok: false, error: e.name };
      // Reported on the item rather than thrown: earlier items are saved,
      // and a failed call would make the caller create them again.
      logger.error({ error: e, teamId }, 'Failed to save an SLO from MCP');
      return {
        index,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };

  registerTool(
    'clickstack_save_slo',
    {
      title: 'Create or Update SLOs',
      annotations: OPEN_WORLD_UPSERT_TOOL,
      description:
        'Create or update service level objectives, 1 to 20 per call. An ' +
        'item with "id" replaces the definition of that SLO (send every ' +
        'field you want to keep; read it with clickstack_get_slo first); an item ' +
        'without "id" creates an SLO. Each item is validated and saved on ' +
        'its own, with the same checks as the SLO builder: the query must ' +
        'run on the source and alert channels must exist. The result lists ' +
        '{ index, ok, id, url } or { index, ok: false, error, issues } per ' +
        'item, where issues name the fields at fault, so fix and retry only ' +
        'the failed items. Check new definitions with clickstack_preview_slo ' +
        'first.',
      inputSchema: mcpSaveSloSchema,
    },
    async ({ slos }) => {
      const results: SaveResult[] = [];
      // One at a time, so the team's SLO limit counts the earlier items.
      for (const [index, item] of slos.entries()) {
        results.push(await saveOne(index, item));
      }
      const failed = results.filter(r => !r.ok).length;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { saved: results.length - failed, failed, results },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
