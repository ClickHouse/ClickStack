import {
  Metadata,
  MetadataCache,
} from '@hyperdx/common-utils/dist/core/metadata';
import type { Connection } from '@hyperdx/common-utils/dist/types';

import { ClickhouseClient } from '@/clickhouse';

// Short, because the point is to see a server change version after an upgrade.
const VERSION_TTL_MS = 60_000;
const VERSION_TIMEOUT_MS = 5_000;

const versionCache = new MetadataCache();

type VersionedConnection = Pick<
  Connection,
  'id' | 'host' | 'username' | 'password'
>;

// '' marks a failed read, so an unreachable server is not asked on every request.
async function readVersion(connection: VersionedConnection): Promise<string> {
  let client: ClickhouseClient | undefined;
  try {
    client = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
      requestTimeout: VERSION_TIMEOUT_MS,
    });
    const version = await new Metadata(
      client,
      new MetadataCache(),
    ).getServerVersion({ connectionId: connection.id });
    return version?.join('.') ?? '';
  } catch {
    return '';
  } finally {
    void client?.close();
  }
}

/**
 * The connection's ClickHouse version if it is cached, starting a lookup
 * otherwise so a later call has it. Never waits on ClickHouse.
 */
export function cachedClickHouseVersion(
  connection: VersionedConnection,
): string | undefined {
  // Keyed on the host as well, so editing a connection's host drops the answer.
  const key = `${connection.id}|${connection.host}`;
  const version = versionCache.get<string>(key);
  if (version === undefined) {
    void versionCache.getOrFetch(key, () => readVersion(connection), {
      ttlMs: VERSION_TTL_MS,
    });
  }
  return version || undefined;
}
