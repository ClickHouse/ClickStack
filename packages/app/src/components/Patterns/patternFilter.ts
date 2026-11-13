import {
  buildCompactPatternPredicate,
  parsePatternPredicate,
} from '@hyperdx/common-utils/dist/drain';
import type { ConditionFilter, Filter } from '@hyperdx/common-utils/dist/types';

import { DRAIN_EXTRA_DELIMITERS } from '@/components/Patterns/drainDelimiters';

export type PatternFilterAction = 'include' | 'exclude';

export type PatternFilter = {
  condition: string;
  valueExpression: string;
  template: string;
  action: PatternFilterAction;
};

// The templates come from the app's miner, so the regex must split on the
// same delimiters.
const options = { extraDelimiters: DRAIN_EXTRA_DELIMITERS };
const NOT = 'NOT ';

/**
 * A search filter that keeps (include) or drops (exclude) every event whose
 * value fits the template, or null when the template is too long to filter on.
 */
export function buildPatternFilter(
  valueExpression: string,
  template: string,
  action: PatternFilterAction,
): ConditionFilter | null {
  // The compact form: filters live in the URL, and people stack many.
  const predicate = buildCompactPatternPredicate(
    valueExpression,
    template,
    options,
  );
  if (predicate == null) return null;
  return {
    type: 'sql',
    condition: action === 'exclude' ? `${NOT}${predicate}` : predicate,
  };
}

/** The pattern behind a filter built by buildPatternFilter, else null. */
export function parsePatternFilter(filter: Filter): PatternFilter | null {
  if (filter.type !== 'sql') return null;
  const excluded = filter.condition.startsWith(NOT);
  const parsed = parsePatternPredicate(
    excluded ? filter.condition.slice(NOT.length) : filter.condition,
    options,
  );
  if (parsed == null) return null;
  return {
    condition: filter.condition,
    ...parsed,
    action: excluded ? 'exclude' : 'include',
  };
}

export function isPatternFilter(filter: Filter): boolean {
  return parsePatternFilter(filter) != null;
}

/**
 * `filters` with `added` appended. Any filter on the same pattern goes, so
 * flipping include and exclude doesn't leave both. An include also replaces
 * the other includes: filters are ANDed, so two would match nothing.
 * Excludes stack.
 */
export function withPatternFilter(
  filters: Filter[],
  added: ConditionFilter,
): Filter[] {
  const pattern = parsePatternFilter(added);
  if (pattern == null) return [...filters, added];
  return [
    ...filters.filter(filter => {
      const existing = parsePatternFilter(filter);
      if (existing == null) return true;
      const samePattern =
        existing.template === pattern.template &&
        existing.valueExpression === pattern.valueExpression;
      const otherInclude =
        pattern.action === 'include' && existing.action === 'include';
      return !samePattern && !otherInclude;
    }),
    added,
  ];
}
