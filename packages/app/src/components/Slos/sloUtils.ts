import type { SloApiResponse, SloState } from '@hyperdx/common-utils/dist/slo';

/** An SLO's state as shown: pending until the background computes it. */
export type SloDisplayState = SloState | 'pending';

/** The states an SLO can be shown in. */
export const SLO_DISPLAY_STATES: SloDisplayState[] = [
  'breached',
  'burning',
  'error',
  'healthy',
  'no_data',
  'pending',
];

export function getSloDisplayState(slo: SloApiResponse): SloDisplayState {
  return slo.status?.state ?? 'pending';
}

export function sloStateLabel(state: SloDisplayState): string {
  switch (state) {
    case 'healthy':
      return 'Healthy';
    case 'burning':
      return 'Burning';
    case 'breached':
      return 'Breached';
    case 'no_data':
      return 'No data';
    case 'error':
      return 'Error';
    case 'pending':
      return 'Pending';
  }
}

export function sloStateDescription(state: SloDisplayState): string {
  switch (state) {
    case 'healthy':
      return 'Within budget, and not spending it fast.';
    case 'burning':
      return 'Spending the error budget fast: the fast burn or slow burn rule holds.';
    case 'breached':
      return 'The error budget for the window is spent.';
    case 'no_data':
      return 'No eligible events in the window.';
    case 'error':
      return 'The last update failed. The numbers shown are the last ones computed.';
    case 'pending':
      return 'The numbers are computed in the background within a few minutes of a save.';
  }
}

/** SLIs near 100% need more decimals to tell 99.9% from 99.99%. */
export function formatSli(sli: number | null | undefined): string {
  if (sli == null) return '-';
  const pct = sli * 100;
  // No bad events at all; more digits would suggest some.
  if (sli === 1) return '100%';
  if (pct >= 99.99) return `${pct.toFixed(3)}%`;
  if (pct >= 99) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

export function formatTarget(target: number): string {
  return `${Number(target.toFixed(3))}%`;
}

export function formatBudget(budget: number | null | undefined): string {
  if (budget == null) return '-';
  const pct = budget * 100;
  return `${Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(pct) < 10 ? 1 : 0,
  }).format(pct)}%`;
}

export function formatBurnRate(burnRate: number | null | undefined): string {
  if (burnRate == null) return '-';
  if (burnRate >= 100) return `${Math.round(burnRate)}x`;
  return `${burnRate.toFixed(burnRate >= 10 ? 1 : 2)}x`;
}

export function budgetColorVar(budget: number | null | undefined): string {
  if (budget == null) return 'var(--color-text-muted)';
  if (budget <= 0) return 'var(--color-text-danger)';
  if (budget < 0.25) return 'var(--color-text-warning)';
  return 'var(--color-text-success)';
}
