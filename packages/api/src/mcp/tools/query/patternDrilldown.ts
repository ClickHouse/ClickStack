import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderWhereExpressionStr } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import type {
  ChartVariable,
  UseTextIndex,
} from '@hyperdx/common-utils/dist/types';
import { substituteVariables } from '@hyperdx/common-utils/dist/variables';

export const PATTERN_MATCH_SEMANTICS =
  'whereSnippet matches values with the same whitespace-separated token count as the ' +
  'template, the same literal tokens (case-sensitive) in the same positions, and exactly ' +
  'one non-whitespace token at each <*>. Every sampled member of the cluster matches. ' +
  'It can also match unsampled events whose shape fits, including ones Drain would have ' +
  'put in a more specific cluster, so the drill-down is a superset of cluster membership.';

/** AND together SQL conditions, skipping blanks. */
export function andSql(...conditions: Array<string | undefined>): string {
  const parts = conditions.filter(
    (c): c is string => c != null && c.trim() !== '',
  );
  if (parts.length <= 1) return parts[0] ?? '';
  return parts.map(c => `(${c})`).join(' AND ');
}

/**
 * Render the caller's filter as SQL so it can be ANDed with a pattern
 * predicate in one clickstack_search `where`. Uses the same rendering as the
 * mining query. Dashboard variables are expanded first because the search
 * tool has no variable context.
 */
export async function userWhereAsSql({
  where,
  whereLanguage,
  variables,
  metadata,
  databaseName,
  tableName,
  connectionId,
  implicitColumnExpression,
  useTextIndexForImplicitColumn,
}: {
  where: string;
  whereLanguage: 'lucene' | 'sql';
  variables?: ChartVariable[];
  metadata: Metadata;
  databaseName: string;
  tableName: string;
  connectionId: string;
  implicitColumnExpression?: string;
  useTextIndexForImplicitColumn?: UseTextIndex;
}): Promise<string> {
  if (!where.trim()) return '';
  const expanded = variables
    ? substituteVariables(where, { variables, inputLanguage: whereLanguage })
    : where;
  return renderWhereExpressionStr({
    condition: expanded,
    language: whereLanguage,
    metadata,
    from: { databaseName, tableName },
    connectionId,
    implicitColumnExpression,
    useTextIndexForImplicitColumn,
  });
}
