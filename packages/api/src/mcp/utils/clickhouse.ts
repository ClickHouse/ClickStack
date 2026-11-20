import type { ClickhouseClientOptions } from '@hyperdx/common-utils/dist/clickhouse';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import type { McpContext } from '@/mcp/tools/types';

export class McpConnectionNotFoundError extends Error {
  constructor(readonly connectionId: string) {
    super(`Connection not found: ${connectionId}`);
    this.name = 'McpConnectionNotFoundError';
  }
}

/**
 * Builds the ClickHouse client for a connection owned by the calling team.
 * All MCP tools must obtain ClickHouse clients through this function.
 *
 * @throws McpConnectionNotFoundError when the team has no such connection.
 */
export async function getMcpClickhouseClient(
  context: McpContext,
  connectionId: string,
  options?: Pick<ClickhouseClientOptions, 'requestTimeout'>,
): Promise<ClickhouseClient> {
  const connection = await getConnectionById(
    context.teamId,
    connectionId,
    true,
  );
  if (!connection) {
    throw new McpConnectionNotFoundError(connectionId);
  }
  return new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
    ...options,
  });
}
