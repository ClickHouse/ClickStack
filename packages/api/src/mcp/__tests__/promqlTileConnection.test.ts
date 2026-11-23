const mockGetConnectionById = jest.fn();
const mockResolvePromqlTarget = jest.fn();

jest.mock('@/controllers/connection', () => ({
  getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
}));
jest.mock('@/controllers/promql', () => ({
  ...jest.requireActual('@/controllers/promql'),
  resolvePromqlTarget: (...args: unknown[]) => mockResolvePromqlTarget(...args),
}));

import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { fromPartial } from '@total-typescript/shoehorn';

import { PromQLQueryError } from '@/controllers/promql';
import { runPromqlTile } from '@/mcp/tools/query/promqlTile';
import type { McpContext } from '@/mcp/tools/types';

const context: McpContext = { teamId: 'team-1', userId: 'user-1' };

describe('runPromqlTile connection lookup', () => {
  it('looks the connection up through the MCP connection helper', async () => {
    mockResolvePromqlTarget.mockResolvedValue({
      status: 404,
      error: 'Source not found',
    });

    await expect(
      runPromqlTile({
        context,
        config: fromPartial({
          source: 'source-1',
          promqlExpression: 'up',
          displayType: DisplayType.Line,
        }),
        dateRange: [new Date(0), new Date(60_000)],
      }),
    ).rejects.toBeInstanceOf(PromQLQueryError);

    const [teamId, sourceId, { getConnection }] =
      mockResolvePromqlTarget.mock.calls[0];
    expect([teamId, sourceId]).toEqual(['team-1', 'source-1']);

    await getConnection('conn-1', { selectPassword: true });
    expect(mockGetConnectionById).toHaveBeenCalledWith(
      'team-1',
      'conn-1',
      true,
    );
  });
});
