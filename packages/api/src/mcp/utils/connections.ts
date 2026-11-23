import mongoose from 'mongoose';

import {
  getConnectionById,
  getConnectionsByTeam,
  validateConnectionId,
} from '@/controllers/connection';
import type { McpContext } from '@/mcp/tools/types';

// Every MCP tool and prompt looks up connections through these helpers, so
// rules about which connections an MCP caller can use live in one place.

/** All of the team's connections, without passwords. */
export function getMcpConnections(context: McpContext) {
  return getConnectionsByTeam(context.teamId);
}

/** The team's connection with this ID, or null when it does not exist. */
export function getMcpConnection(
  context: McpContext,
  connectionId: string,
  { selectPassword = false }: { selectPassword?: boolean } = {},
) {
  return getConnectionById(context.teamId, connectionId, selectPassword);
}

/** Checks that `connectionId` is a valid ID of one of the team's connections. */
export function validateMcpConnectionId(
  context: McpContext,
  connectionId: unknown,
) {
  return validateConnectionId(
    connectionId,
    new mongoose.Types.ObjectId(context.teamId),
  );
}
