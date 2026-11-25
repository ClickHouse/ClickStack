const mockGetConnectionById = jest.fn();
const mockGetConnectionsByTeam = jest.fn();
const mockValidateConnectionId = jest.fn();

jest.mock('@/controllers/connection', () => ({
  getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
  getConnectionsByTeam: (...args: unknown[]) =>
    mockGetConnectionsByTeam(...args),
  validateConnectionId: (...args: unknown[]) =>
    mockValidateConnectionId(...args),
}));

import mongoose from 'mongoose';

import type { McpContext } from '@/mcp/tools/types';
import {
  getMcpConnection,
  getMcpConnections,
  validateMcpConnectionId,
} from '@/mcp/utils/connections';

const teamId = new mongoose.Types.ObjectId().toString();
const context: McpContext = { teamId, userId: 'user-1' };
const connection = { _id: 'conn-1', name: 'Local' };

describe('MCP connection lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getMcpConnections scopes the lookup to the caller team', async () => {
    mockGetConnectionsByTeam.mockResolvedValue([connection]);
    await expect(getMcpConnections(context)).resolves.toEqual([connection]);
    expect(mockGetConnectionsByTeam).toHaveBeenCalledWith(teamId);
  });

  it('getMcpConnection omits the password unless asked for it', async () => {
    mockGetConnectionById.mockResolvedValue(connection);

    await expect(getMcpConnection(context, 'conn-1')).resolves.toBe(connection);
    expect(mockGetConnectionById).toHaveBeenLastCalledWith(
      teamId,
      'conn-1',
      false,
    );

    await getMcpConnection(context, 'conn-1', { selectPassword: true });
    expect(mockGetConnectionById).toHaveBeenLastCalledWith(
      teamId,
      'conn-1',
      true,
    );
  });

  it('getMcpConnection returns null when the connection is not found', async () => {
    mockGetConnectionById.mockResolvedValue(null);
    await expect(getMcpConnection(context, 'missing')).resolves.toBeNull();
  });

  it('validateMcpConnectionId checks against the caller team', async () => {
    const failure = {
      ok: false,
      status: 400,
      message: 'connection must be an existing connection id',
    };
    mockValidateConnectionId.mockResolvedValue(failure);

    await expect(validateMcpConnectionId(context, 'conn-1')).resolves.toBe(
      failure,
    );
    const [connectionId, team] = mockValidateConnectionId.mock.calls[0];
    expect(connectionId).toBe('conn-1');
    expect(team).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(team.toString()).toBe(teamId);
  });
});
