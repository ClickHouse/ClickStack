import { BuilderChartConfig } from '@hyperdx/common-utils/dist/types';

/**
 * Keeps only the alias WITH clauses that `texts` (the where, filters and
 * group by) reference, directly or through another kept alias. The histogram
 * doesn't select the table's columns, so the rest only change its query key
 * and refetch it whenever a column is added or removed.
 */
export function getReferencedWithClauses(
  withClauses: BuilderChartConfig['with'],
  texts: string[],
): BuilderChartConfig['with'] {
  if (!withClauses) return undefined;

  const kept = new Set<string>();
  let haystack = texts.join('\n');
  let added = true;
  while (added) {
    added = false;
    for (const clause of withClauses) {
      // Substring match over-includes (e.g. `svc` in `svc_name`), which only
      // costs a refetch; under-including would break the query.
      if (!kept.has(clause.name) && haystack.includes(clause.name)) {
        kept.add(clause.name);
        haystack += `\n${clause.sql?.sql ?? ''}`;
        added = true;
      }
    }
  }

  const referenced = withClauses.filter(clause => kept.has(clause.name));
  return referenced.length > 0 ? referenced : undefined;
}
