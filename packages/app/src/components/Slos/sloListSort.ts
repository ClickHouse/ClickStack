import { compareSlosWorstFirst } from '@hyperdx/common-utils/dist/core/sloStats';
import type { SloApiResponse } from '@hyperdx/common-utils/dist/slo';

export const SLO_SORT_OPTIONS = [
  { value: 'worst', label: 'Worst first' },
  { value: 'name', label: 'Name' },
  { value: 'sli', label: 'Lowest SLI' },
  { value: 'budget', label: 'Least budget left' },
  { value: 'burn', label: 'Fastest burn' },
] as const;

export type SloSort = (typeof SLO_SORT_OPTIONS)[number]['value'];

export const SLO_SORT_VALUES = SLO_SORT_OPTIONS.map(o => o.value);

export const DEFAULT_SLO_SORT: SloSort = 'worst';

export function isSloSort(value: string | null): value is SloSort {
  return SLO_SORT_VALUES.some(sort => sort === value);
}

type SloCompare = (a: SloApiResponse, b: SloApiResponse) => number;

/** Ascending by a number; SLOs without one (no update yet) come last. */
const byNumber =
  (value: (slo: SloApiResponse) => number | null | undefined): SloCompare =>
  (a, b) => {
    const x = value(a);
    const y = value(b);
    if (x == null || y == null)
      return (x == null ? 1 : 0) - (y == null ? 1 : 0);
    return x - y;
  };

export function compareSlos(sort: SloSort): SloCompare {
  switch (sort) {
    case 'worst':
      return compareSlosWorstFirst;
    case 'name':
      return (a, b) => a.name.localeCompare(b.name);
    case 'sli':
      return byNumber(slo => slo.status?.sli);
    case 'budget':
      return byNumber(slo => slo.status?.budgetRemaining);
    case 'burn':
      // Fastest first: the 1h condition's rate, negated.
      return byNumber(slo => {
        const rate = slo.status?.burn[0]?.burnRate;
        return rate == null ? null : -rate;
      });
  }
}
