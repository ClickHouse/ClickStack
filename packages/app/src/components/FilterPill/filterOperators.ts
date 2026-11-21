import {
  AdhocFilterOperator,
  PROMQL_ADHOC_FILTER_OPERATORS,
} from '@hyperdx/common-utils/dist/types';

import type { FilterOperatorOption } from './FilterConditionEditor';

export type FilterLanguage = 'sql' | 'promql';

/** One spelling for both languages; each preset's labels show its own wording. */
export type FilterOperator = AdhocFilterOperator;

const REGEX_VALUE = {
  valueLabel: 'Pattern',
  valuePlaceholder: 'Regular expression',
};
const LIKE_VALUE = { valuePlaceholder: 'Pattern, e.g. %error%' };

export const SQL_FILTER_OPERATORS: FilterOperatorOption<FilterOperator>[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=', negated: true },
  { value: '=~', label: 'regex', ...REGEX_VALUE },
  { value: '!~', label: 'not regex', negated: true, ...REGEX_VALUE },
  { value: 'LIKE', label: 'like', ...LIKE_VALUE },
  { value: 'NOT LIKE', label: 'not like', negated: true, ...LIKE_VALUE },
  // One value per condition; the renderer ORs conditions sharing a key.
  {
    value: 'IN',
    label: 'in',
    valuePlaceholder: "OR'd with this key's other values",
  },
];

// Derived so the editor never offers an operator the PromQL broadcast skips.
// PromQL users know the operator syntax, so it doubles as the label. PromQL has
// no `IN`, so it borrows Grafana's `=|`.
export const PROMQL_FILTER_OPERATORS: FilterOperatorOption<FilterOperator>[] =
  SQL_FILTER_OPERATORS.filter(op =>
    PROMQL_ADHOC_FILTER_OPERATORS.includes(op.value),
  ).map(op => ({ ...op, label: op.value === 'IN' ? '=|' : op.value }));

export function getFilterOperators(
  language: FilterLanguage,
): FilterOperatorOption<FilterOperator>[] {
  return language === 'promql' ? PROMQL_FILTER_OPERATORS : SQL_FILTER_OPERATORS;
}

/** How a pill shows `operator`: its label, and whether it excludes values. */
export function getFilterOperatorDisplay(
  language: FilterLanguage,
  operator: string,
): { label: string; isExcluded: boolean } {
  const option = getFilterOperators(language).find(op => op.value === operator);
  return { label: option?.label ?? operator, isExcluded: !!option?.negated };
}
