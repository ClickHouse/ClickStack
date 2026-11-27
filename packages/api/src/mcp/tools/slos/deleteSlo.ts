import { z } from 'zod/v3';

import { deleteSlo } from '@/controllers/slo';
import { IDEMPOTENT_DESTRUCTIVE_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import { objectIdSchema } from '@/utils/zod';

export function registerDeleteSlo({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_delete_slo',
    {
      title: 'Delete SLO',
      annotations: IDEMPOTENT_DESTRUCTIVE_TOOL,
      description:
        'Permanently delete an SLO by ID, together with its burn alerts. ' +
        'Use clickstack_get_slo (without an ID) to list SLO IDs.',
      inputSchema: z.object({
        id: objectIdSchema.describe(
          'ID of the SLO to delete, from clickstack_get_slo.',
        ),
      }),
    },
    async ({ id }) => {
      if (!(await deleteSlo(teamId, id))) {
        return mcpUserError('SLO not found');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: true, id }, null, 2),
          },
        ],
      };
    },
  );
}
