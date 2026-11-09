import SqlString from 'sqlstring';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';

import { MAX_SERVICE_MAP_GROUP_BY } from '@/hooks/useServiceMap';

const EMPTY_DIMENSION_LABEL = '(none)';

/**
 * Splits the comma-separated group-by URL param into SQL expressions, capped
 * at MAX_SERVICE_MAP_GROUP_BY so a hand-edited URL cannot exceed the limit.
 */
export function parseServiceMapGroupBy(groupBy: string | null | undefined) {
  return splitAndTrimWithBracket(groupBy ?? '').slice(
    0,
    MAX_SERVICE_MAP_GROUP_BY,
  );
}

/** The second label line of a node: dimension values joined by " · ". */
export function formatServiceMapDimensions(
  dimensions: string[],
): string | undefined {
  if (dimensions.length === 0) {
    return undefined;
  }
  return dimensions
    .map(value => (value === '' ? EMPTY_DIMENSION_LABEL : value))
    .join(' · ');
}

/**
 * SQL fragment, starting with " AND ", that pins a search to one node's
 * dimension values. Empty when the map has no extra dimensions.
 */
export function buildServiceMapDimensionsWhere(
  groupBy: string[],
  dimensions: string[],
): string {
  return groupBy
    .map((expression, i) =>
      SqlString.format(' AND ? = ?', [
        SqlString.raw(expression),
        dimensions[i] ?? '',
      ]),
    )
    .join('');
}
