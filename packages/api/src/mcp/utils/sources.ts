import { getSource, getSources } from '@/controllers/sources';
import type { McpContext } from '@/mcp/tools/types';
import { isHiddenSource } from '@/mcp/utils/promql';

// Every MCP tool and prompt resolves sources through these helpers, so
// rules about which sources an MCP caller can see live in one place.

/** The team's source with this ID, or null when it does not exist. */
export function getMcpSource(context: McpContext, sourceId: string) {
  return getSource(context.teamId, sourceId);
}

/** All of the team's sources, including ones hidden from the agent. */
export function getMcpSources(context: McpContext) {
  return getSources(context.teamId);
}

/** The team's sources minus those `isHiddenSource` hides from the agent. */
export async function getVisibleMcpSources(context: McpContext) {
  const sources = await getMcpSources(context);
  return sources.filter(s => !isHiddenSource(context, s));
}

/** Like `getMcpSource`, but null when the source is hidden from the agent. */
export async function getVisibleMcpSource(
  context: McpContext,
  sourceId: string,
) {
  const source = await getMcpSource(context, sourceId);
  return source && !isHiddenSource(context, source) ? source : null;
}
