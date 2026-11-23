import { getParseErrorMessage } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { z } from 'zod';

import { mcpSaveAlertSchema } from '@/mcp/tools/alerts/schemas';
import {
  buildMcpPatchDashboardSchema,
  buildMcpTilesParam,
  mcpSavedFilterValuesParam,
} from '@/mcp/tools/dashboards/schemas';
import { mcpSaveSavedSearchSchema } from '@/mcp/tools/savedSearches/schemas';
import { mcpUnion } from '@/mcp/utils/errors';

// The text an agent sees: the MCP SDK's rendering of the tool-args parse error.
const agentMessage = (schema: z.ZodTypeAny, input: unknown) => {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? '' : getParseErrorMessage(result.error);
};

describe('mcpUnion', () => {
  const tile = mcpUnion([
    z.object({ displayType: z.literal('markdown'), markdown: z.string() }),
    z.object({
      displayType: z.literal('line'),
      sourceId: z.string(),
      aggFn: z.enum(['count', 'sum']).optional(),
      whereLanguage: z.enum(['sql', 'lucene']).optional(),
    }),
    z.object({
      configType: z.literal('sql'),
      displayType: z.enum(['line', 'table']),
      connectionId: z.string(),
      sqlTemplate: z.string(),
    }),
  ]);
  const args = z.object({ tiles: z.array(tile) });

  it('reports the branch whose discriminator matched, even with more issues', () => {
    expect(
      agentMessage(args, { tiles: [{ displayType: 'line', aggFn: 'bogus' }] }),
    ).toBe(
      "sourceId: Required; aggFn: Invalid enum value. Expected 'count' | 'sum', received 'bogus' at tiles[0]",
    );
  });

  it('prefers the branch that declares the configType the input set', () => {
    expect(
      agentMessage(args, {
        tiles: [
          { configType: 'sql', displayType: 'line', whereLanguage: 'sql' },
        ],
      }),
    ).toBe('connectionId: Required; sqlTemplate: Required at tiles[0]');
  });

  it("lists only the matched branch's values, and keeps its other issues", () => {
    expect(
      agentMessage(args, {
        tiles: [{ configType: 'sql', displayType: 'markdown' }],
      }),
    ).toBe(
      'displayType: expected one of "line", "table"; connectionId: Required; sqlTemplate: Required at tiles[0]',
    );
  });

  it('lists every accepted value when no branch fits', () => {
    expect(agentMessage(args, { tiles: [{ displayType: 'area' }] })).toBe(
      'displayType: expected one of "markdown", "line", "table" at tiles[0]',
    );
  });
});

describe('MCP tool unions keep their specific messages', () => {
  const tileWithWhere = {
    name: 'T',
    config: {
      displayType: 'line',
      sourceId: 's',
      select: [{ aggFn: 'count' }],
      where: 'level:error',
    },
  };
  const whereMessage =
    'config.where: This tile type has no tile-level `where`. Put the filter ' +
    "on each select item's `where` instead (that is the tile's visible " +
    '"Where" box); use a dashboard-level filter to scope the whole dashboard.';

  it.each([false, true])('save tiles, PromQL %s', promqlEnabled => {
    expect(
      agentMessage(z.object({ tiles: buildMcpTilesParam(promqlEnabled) }), {
        tiles: [tileWithWhere],
      }),
    ).toBe(`${whereMessage} at tiles[0]`);
  });

  it.each([false, true])('patch tile, PromQL %s', promqlEnabled => {
    expect(
      agentMessage(
        buildMcpPatchDashboardSchema(promqlEnabled).pick({ tile: true }),
        { tile: tileWithWhere },
      ),
    ).toBe(`${whereMessage} at tile`);
  });

  it('does not repeat the path of a nested union', () => {
    expect(
      agentMessage(z.object({ tiles: buildMcpTilesParam(true) }), {
        tiles: [
          {
            name: 'T',
            config: {
              configType: 'promql',
              displayType: 'line',
              expressions: [{ expression: 'up' }],
              granularity: '5m',
            },
          },
        ],
      }),
    ).toBe(
      'config.sourceId: Required; config.granularity: Invalid at tiles[0]',
    );
  });

  it('keeps a builder tile with many mistakes on the builder branch', () => {
    expect(
      agentMessage(z.object({ tiles: buildMcpTilesParam(true) }), {
        tiles: [
          {
            name: 'T',
            config: {
              displayType: 'line',
              select: 'count()',
              groupBy: 3,
              granularity: 7,
              where: 'x',
            },
          },
        ],
      }),
    ).toBe(
      `${whereMessage}; config.sourceId: Required; ` +
        'config.select: Expected array, received string; ' +
        'config.groupBy: Expected string, received number at tiles[0]',
    );
  });

  it('judges a raw SQL alert chart config as SQL', () => {
    expect(
      agentMessage(mcpSaveAlertSchema.pick({ chartConfig: true }), {
        chartConfig: {
          configType: 'sql',
          displayType: 'line',
          connectionId: 'c',
          sqlTemplate: 'SELECT 1',
          whereLanguage: 'sql',
        },
      }),
    ).toBe(
      'whereLanguage: Raw SQL alert configs have no chart-level where; filter inside the sqlTemplate instead at chartConfig',
    );
  });

  it('lists the saved filter value kinds', () => {
    expect(
      agentMessage(z.object({ values: mcpSavedFilterValuesParam }), {
        values: [{ type: 'bogus' }],
      }),
    ).toBe('type: expected one of "sql", "variable", "adhoc" at values[0]');
  });

  it('reports the matched saved search filter kind', () => {
    expect(
      agentMessage(mcpSaveSavedSearchSchema.pick({ filters: true }), {
        filters: [{ type: 'sql_ast', operator: '~' }],
      }),
    ).toBe(
      "operator: Invalid enum value. Expected '=' | '<' | '>' | '!=' | '<=' | '>=', received '~'; left: Required; right: Required at filters[0]",
    );
  });
});
