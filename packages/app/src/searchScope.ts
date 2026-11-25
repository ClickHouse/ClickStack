import { parseAsStringEnum } from 'nuqs';
import {
  SearchScope,
  SearchScopeSchema,
} from '@hyperdx/common-utils/dist/types';

/** A stored or URL scope, falling back to span for anything unknown or unset. */
export function resolveSearchScope(scope: unknown): SearchScope {
  return SearchScopeSchema.catch('span').parse(scope);
}

export const SEARCH_SCOPE_PARAM = parseAsStringEnum<SearchScope>(
  SearchScopeSchema.options,
);

// Shown only when trace scope actually ran; span scope has no indicator.
export const TRACE_SCOPE_LABEL = 'Scope: Trace';

export const TRACE_ZERO_EMPTY_DESCRIPTION =
  'No traces match all predicates at trace scope.';
