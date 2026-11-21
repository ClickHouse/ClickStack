import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * The four behavior hints every tool must declare. Platform compatibility
 * checks reject tools that leave any of them unset.
 */
export type ToolBehaviorAnnotations = Required<
  Pick<
    ToolAnnotations,
    'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'
  >
>;

// Tools read or write only the calling team's own ClickStack metadata
// (MongoDB) and telemetry (ClickHouse), so they are closed-world. The
// exception is OPEN_WORLD_UPSERT_TOOL.

export const READ_ONLY_TOOL: ToolBehaviorAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * Create-or-update tools: omitting `id` creates a new object on every call
 * (not idempotent), and providing `id` overwrites the stored object.
 */
export const UPSERT_TOOL: ToolBehaviorAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/**
 * Upserts whose saved object makes ClickStack send HTTP requests to
 * third-party endpoints (webhooks, and the alerts that notify them).
 */
export const OPEN_WORLD_UPSERT_TOOL: ToolBehaviorAnnotations = {
  ...UPSERT_TOOL,
  openWorldHint: true,
};

/**
 * Updates or deletes an existing object by ID. Repeating the call with the
 * same arguments leaves the same end state.
 */
export const IDEMPOTENT_DESTRUCTIVE_TOOL: ToolBehaviorAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
