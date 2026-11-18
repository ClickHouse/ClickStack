import { z } from 'zod';

import {
  buildMcpPatchDashboardSchema,
  buildMcpTilesParam,
} from '@/mcp/tools/dashboards/schemas';
import { mcpUnion } from '@/mcp/utils/errors';

// MCP SDK 1.30+ prints only the top-level issue, so that is what agents see.
const topLevelMessage = (schema: z.ZodTypeAny, input: unknown) => {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? '' : result.error.issues[0].message;
};

describe('mcpUnion', () => {
  const tile = mcpUnion([
    z.object({ displayType: z.literal('markdown'), markdown: z.string() }),
    z.object({
      displayType: z.literal('line'),
      sourceId: z.string(),
      select: z.string(),
    }),
    z.object({
      configType: z.literal('sql'),
      displayType: z.enum(['line', 'table']),
      connectionId: z.string(),
      sqlTemplate: z.string(),
    }),
  ]);

  it('reports the branch whose discriminator matched, even with more issues', () => {
    expect(topLevelMessage(tile, { displayType: 'line' })).toBe(
      'sourceId: Required\nselect: Required',
    );
  });

  it('prefers the branch whose configType the input set', () => {
    expect(
      topLevelMessage(tile, { configType: 'sql', displayType: 'line' }),
    ).toBe('connectionId: Required\nsqlTemplate: Required');
  });

  it('lists every accepted value when no branch accepts the discriminator', () => {
    expect(topLevelMessage(tile, { displayType: 'area' })).toBe(
      'displayType: expected one of "markdown", "line", "table"',
    );
  });
});

describe('MCP tile unions report refinement messages', () => {
  const builderTileWithWhere = {
    name: 'T',
    config: {
      displayType: 'line',
      sourceId: 'source',
      select: [{ aggFn: 'count' }],
      where: 'level:error',
    },
  };

  it.each([
    ['save, PromQL off', buildMcpTilesParam(false)],
    ['save, PromQL on', buildMcpTilesParam(true)],
  ])('%s', (_, schema) => {
    expect(topLevelMessage(schema, [builderTileWithWhere])).toContain(
      'no tile-level `where`',
    );
  });

  it.each([
    ['patch, PromQL off', buildMcpPatchDashboardSchema(false)],
    ['patch, PromQL on', buildMcpPatchDashboardSchema(true)],
  ])('%s', (_, schema) => {
    expect(topLevelMessage(schema.shape.tile, builderTileWithWhere)).toContain(
      'no tile-level `where`',
    );
  });
});
