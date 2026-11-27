import {
  NOT_REASONS_TO_USE_SQL,
  SQL_FALLBACK_CRITERIA,
} from '@/mcp/tools/query/builderCatalog';
import { McpContext } from '@/mcp/tools/types';

import { createTestClient } from './mcpTestUtils';

describe('MCP tool descriptions', () => {
  const context: McpContext = { teamId: 'team-id', userId: 'user-id' };

  // Claude Code truncates tool descriptions and server instructions past
  // this many UTF-8 bytes.
  const CLAUDE_CODE_METADATA_LIMIT = 2048;

  async function getMetadata() {
    const client = await createTestClient(context);
    const { tools } = await client.listTools();
    return {
      instructions: client.getInstructions() ?? '',
      descriptions: new Map(
        tools.map(tool => [tool.name, tool.description ?? '']),
      ),
    };
  }

  it('keeps tool descriptions and server instructions within the Claude Code limit', async () => {
    const { instructions, descriptions } = await getMetadata();
    expect(descriptions.size).toBeGreaterThan(0);

    const texts = [
      ['instructions', instructions] as const,
      ...Array.from(descriptions, ([name, text]) => [name, text] as const),
    ];

    expect(
      texts.filter(([, text]) => text.trim() === '').map(([name]) => name),
    ).toEqual([]);

    const oversized = texts
      .map(([name, text]) => [name, Buffer.byteLength(text, 'utf8')] as const)
      .filter(([, bytes]) => bytes > CLAUDE_CODE_METADATA_LIMIT);

    expect(oversized).toEqual([]);
  });

  it('names the real SQL fallbacks and the needs builders already cover', async () => {
    const { instructions, descriptions } = await getMetadata();
    const sql = descriptions.get('clickstack_sql') ?? '';

    for (const text of [instructions, sql]) {
      expect(text).toContain(SQL_FALLBACK_CRITERIA);
      expect(text).toContain(NOT_REASONS_TO_USE_SQL);
      expect(text).not.toContain('CTEs');
    }

    expect(SQL_FALLBACK_CRITERIA).toContain('per-row ordering');
    expect(SQL_FALLBACK_CRITERIA).toContain('already-aggregated result');
    expect(NOT_REASONS_TO_USE_SQL).toContain('clickstack_table `having`');
    expect(NOT_REASONS_TO_USE_SQL).toContain('includeLogs');
    expect(NOT_REASONS_TO_USE_SQL).toContain(
      'clickstack_trace_top_time_consuming_ops',
    );
  });

  it('documents builder capabilities before the SQL nudge', async () => {
    const { descriptions } = await getMetadata();
    const cases = [
      [
        'clickstack_table',
        [
          '"having" filters aggregated groups',
          'groupBy and valueExpression accept ClickHouse expressions',
          'each select item has its own "where"',
        ],
      ],
      [
        'clickstack_timeseries',
        [
          'groupBy and valueExpression accept ClickHouse expressions',
          'each select item can set its own "where"',
        ],
      ],
    ] as const;

    for (const [name, phrases] of cases) {
      const description = descriptions.get(name) ?? '';
      const nudgeAt = description.indexOf('PREFER THIS over clickstack_sql');
      expect(nudgeAt).toBeGreaterThan(0);
      for (const phrase of phrases) {
        const phraseAt = description.indexOf(phrase);
        expect(phraseAt).toBeGreaterThanOrEqual(0);
        expect(phraseAt).toBeLessThan(nudgeAt);
      }
    }
  });
});
