import { ClickHouseError } from '@clickhouse/client-common';

/**
 * Check whether an error is a ClickHouseError, using both `instanceof`
 * and a constructor-name fallback. The fallback handles the case where
 * multiple copies of `@clickhouse/client-common` are installed (e.g.
 * the root workspace uses one version while `common-utils` bundles
 * another). In that scenario, `instanceof` fails because the class
 * identities are different even though the shapes are identical.
 */
export function isClickHouseError(
  err: unknown,
): err is ClickHouseError & { type: string } {
  if (err instanceof ClickHouseError) return true;
  if (
    err instanceof Error &&
    err.constructor?.name === 'ClickHouseError' &&
    'type' in err &&
    typeof err.type === 'string'
  ) {
    return true;
  }
  return false;
}

/**
 * Extract the ClickHouse error `type` (e.g. `UNKNOWN_TABLE`) from an error,
 * walking `.cause` to find the original `ClickHouseError` from
 * `@clickhouse/client-common`.
 *
 * Uses `instanceof` with a constructor-name fallback to handle duplicate
 * package installations across the monorepo (see `isClickHouseError`).
 */
export function getClickHouseErrorType(e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  // ClickHouseQueryError wraps the original ClickHouseError as .cause
  if (isClickHouseError(e.cause)) {
    return e.cause.type;
  }
  // Direct ClickHouseError (has .type on itself)
  if (isClickHouseError(e)) {
    return e.type;
  }
  return undefined;
}
