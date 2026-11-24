const mockGetConnectionById = jest.fn();
const mockClickhouseClient = jest.fn();

jest.mock('@/controllers/connection', () => ({
  getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
}));
jest.mock('@/clickhouse', () => ({ ClickhouseClient: mockClickhouseClient }));

import type { McpContext } from '@/mcp/tools/types';
import {
  getMcpClickhouseClient,
  McpConnectionNotFoundError,
} from '@/mcp/utils/clickhouse';

const context: McpContext = { teamId: 'team-1', userId: 'user-1' };
const connection = {
  host: 'http://ch:8123',
  username: 'default',
  password: 'secret',
};

describe('getMcpClickhouseClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('looks the connection up for the calling team, with its password', async () => {
    mockGetConnectionById.mockResolvedValue(connection);

    const client = await getMcpClickhouseClient(context, 'conn-1');

    expect(mockGetConnectionById).toHaveBeenCalledWith(
      'team-1',
      'conn-1',
      true,
    );
    expect(client).toBe(mockClickhouseClient.mock.instances[0]);
    expect(mockClickhouseClient.mock.calls[0][0]).toStrictEqual({
      host: 'http://ch:8123',
      username: 'default',
      password: 'secret',
    });
  });

  it('passes requestTimeout through to the client', async () => {
    mockGetConnectionById.mockResolvedValue(connection);

    await getMcpClickhouseClient(context, 'conn-1', { requestTimeout: 5000 });

    expect(mockClickhouseClient.mock.calls[0][0]).toStrictEqual({
      host: 'http://ch:8123',
      username: 'default',
      password: 'secret',
      requestTimeout: 5000,
    });
  });

  it('throws McpConnectionNotFoundError when the team has no such connection', async () => {
    mockGetConnectionById.mockResolvedValue(null);

    const result = getMcpClickhouseClient(context, 'conn-1');

    await expect(result).rejects.toBeInstanceOf(McpConnectionNotFoundError);
    await expect(result).rejects.toMatchObject({ connectionId: 'conn-1' });
    expect(mockClickhouseClient).not.toHaveBeenCalled();
  });

  it('propagates lookup failures unchanged', async () => {
    const failure = new Error('db down');
    mockGetConnectionById.mockRejectedValue(failure);

    await expect(getMcpClickhouseClient(context, 'conn-1')).rejects.toBe(
      failure,
    );
  });
});
