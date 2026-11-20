import { parseVariableReference } from '@hyperdx/common-utils/dist/referenceVariables';

type ConnectionSourceSyncResult =
  | { field: 'connection'; value: string }
  | { field: 'source'; value: '' }
  | null;

/**
 * Decides how a form's `connection` and `source` fields should be kept in
 * sync. Extracted as a pure function so the behavior can be unit tested
 * independently of the components' effects.
 */
export function resolveConnectionSourceSync({
  source,
  connection,
  prevSource,
  prevConnection,
  sources,
}: {
  source: string | undefined;
  connection: string | undefined;
  prevSource: string | undefined;
  prevConnection: string | undefined;
  sources: { id: string; connection: string }[] | undefined;
}): ConnectionSourceSyncResult {
  if (!sources) return null;
  // A data source variable reference isn't bound to a connection here: the
  // filter bar decides what it selects, so it neither moves the connection
  // nor is cleared by a connection change.
  const isSourceReference = parseVariableReference(source) != null;

  // When the source changes, sync the connection to match.
  if (source !== prevSource) {
    if (isSourceReference) return null;
    const sourceConnection = sources.find(s => s.id === source)?.connection;
    if (sourceConnection && sourceConnection !== connection) {
      return { field: 'connection', value: sourceConnection };
    }
    return null;
  }

  // Set a default connection when none is selected.
  if (!connection) {
    const defaultConnection = sources[0]?.connection;
    if (defaultConnection) {
      return { field: 'connection', value: defaultConnection };
    }
    return null;
  }

  // When the connection changes, clear the source only if the currently
  // selected source doesn't belong to the new connection. This avoids clearing
  // a source that was just carried over (e.g. from builder mode), where the
  // connection change above was itself triggered by the source.
  if (connection !== prevConnection && prevConnection !== undefined) {
    const sourceConnection = sources.find(s => s.id === source)?.connection;
    if (source && !isSourceReference && sourceConnection !== connection) {
      return { field: 'source', value: '' };
    }
  }

  return null;
}
