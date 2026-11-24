import { getSloBurnRule } from '@hyperdx/common-utils/dist/core/slo';
import {
  getSloBurnWindowMs,
  getSloWindowMs,
  type SloApiResponse,
  type SloBurnWindow,
  type SloState,
  type SloWindow,
} from '@hyperdx/common-utils/dist/slo';
import type { TSource } from '@hyperdx/common-utils/dist/types';

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

/** "hour" or "5 minutes", as in "the last hour". */
export function formatBurnWindow(window: SloBurnWindow): string {
  switch (window) {
    case '5m':
      return '5 minutes';
    case '30m':
      return '30 minutes';
    case '1h':
      return 'hour';
    case '6h':
      return '6 hours';
  }
}

/** "the last hour" or "the last 5 minutes", for sentences about a window. */
export function describeBurnWindow(window: SloBurnWindow): string {
  return `the last ${formatBurnWindow(window)}`;
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

export function formatCount(n: number | null | undefined): string {
  if (n == null) return '-';
  return Intl.NumberFormat('en-US', {
    notation: Math.abs(n) >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(n) >= 100_000 ? 1 : 0,
  }).format(n);
}

export function formatSloWindow(window: SloWindow): string {
  return window === '7d' ? '7 days' : '30 days';
}

/**
 * A bad-events view of the burn rule's first window (the last hour) or the
 * SLO window, ending now.
 */
export function getSloEventsRange(
  slo: SloApiResponse,
  range: 'burn' | 'window',
  nowMs: number,
): [number, number] {
  const lengthMs =
    range === 'window'
      ? getSloWindowMs(slo.window)
      : getSloBurnWindowMs(getSloBurnRule(slo.window)[0].window);
  return [nowMs - lengthMs, nowMs];
}

export function budgetColorVar(budget: number | null | undefined): string {
  if (budget == null) return 'var(--color-text-muted)';
  if (budget <= 0) return 'var(--color-text-danger)';
  if (budget < 0.25) return 'var(--color-text-warning)';
  return 'var(--color-text-success)';
}

/** Default Search columns of a log or trace source. */
export function getSourceDefaultSelect(
  source: TSource | undefined,
): string | undefined {
  return source && 'defaultTableSelectExpression' in source
    ? source.defaultTableSelectExpression
    : undefined;
}
