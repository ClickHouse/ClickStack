import {
  getSloBurnCounts,
  getSloBurnQueryRange,
  getSloBurnRule,
  parseSloGroupHistoryRows,
  parseSloHistoryRows,
  type SloBurnCounts,
  type SloBurnRule,
  type SloCounts,
} from '@/core/slo';
import {
  SLO_GROUP_MIN_EVENTS,
  type SloBurnStats,
  type SloGroupState,
  type SloState,
  type SloStats,
  type SloWindow,
} from '@/slo';

/** Allowed bad fraction, 1 - target. Target is a percentage. */
export function getAllowedBadFraction(target: number): number {
  return 1 - target / 100;
}

/**
 * The bad rate among eligible events as a multiple of the allowed bad rate.
 * At 1x the error budget lasts exactly the SLO window.
 */
export function computeSloBurnRate(
  eligible: number,
  good: number,
  target: number,
): number | null {
  const allowedBad = getAllowedBadFraction(target);
  return eligible > 0 && allowedBad > 0
    ? Math.max(0, eligible - good) / eligible / allowedBad
    : null;
}

/** Each condition of the rule with its burn rates, from its counts. */
export function computeSloBurnStats(
  counts: SloBurnCounts[],
  rule: SloBurnRule,
  target: number,
): SloBurnStats[] {
  return rule.map((condition, i) => {
    const c = counts.at(i) ?? {
      eligible: 0,
      good: 0,
      shortEligible: 0,
      shortGood: 0,
    };
    return {
      ...condition,
      eligible: c.eligible,
      bad: Math.max(0, c.eligible - c.good),
      burnRate: computeSloBurnRate(c.eligible, c.good, target),
      shortBurnRate: computeSloBurnRate(c.shortEligible, c.shortGood, target),
    };
  });
}

/**
 * The burn rule's numbers from the rows of the burn query
 * (buildSloBurnChartConfig) run at `now`.
 */
export function computeSloBurnFromRows(
  rows: Record<string, unknown>[],
  slo: { window: SloWindow; target: number },
  now: Date,
): SloBurnStats[] {
  const rule = getSloBurnRule(slo.window);
  const counts = getSloBurnCounts(
    parseSloHistoryRows(rows),
    rule,
    getSloBurnQueryRange(now)[1],
  );
  return computeSloBurnStats(counts, rule, slo.target);
}

/**
 * The burn rule's numbers for each of `groups`, from a burn query by group.
 * A group without rows had no events in the burn windows, so no burn.
 */
export function computeSloGroupBurnFromRows(
  rows: Record<string, unknown>[],
  slo: { window: SloWindow; target: number },
  now: Date,
  groups: string[],
): Map<string, SloBurnStats[]> {
  const rule = getSloBurnRule(slo.window);
  const end = getSloBurnQueryRange(now)[1];
  const buckets = parseSloGroupHistoryRows(rows);
  return new Map(
    groups.map(value => [
      value,
      computeSloBurnStats(
        getSloBurnCounts(buckets.get(value) ?? [], rule, end),
        rule,
        slo.target,
      ),
    ]),
  );
}

export function computeSloStats(
  counts: SloCounts,
  burn: SloBurnStats[],
  target: number,
): SloStats {
  // Bad is derived, never counted, so an event whose good condition is NULL
  // lands here instead of disappearing from both sides.
  const bad = Math.max(0, counts.eligible - counts.good);
  const errorBudget = getAllowedBadFraction(target) * counts.eligible;
  return {
    eligible: counts.eligible,
    good: counts.good,
    bad,
    sli: counts.eligible > 0 ? counts.good / counts.eligible : null,
    errorBudget,
    budgetRemaining:
      counts.eligible > 0 && errorBudget > 0 ? 1 - bad / errorBudget : null,
    budgetRemainingEvents: errorBudget - bad,
    burn,
  };
}

/**
 * One condition of the burn rule holds: its long window has enough events
 * and burns at or above the threshold, and so does its short window, so the
 * condition stops holding soon after the burn does.
 */
export function isSloBurnConditionMet(burn: SloBurnStats): boolean {
  return (
    burn.eligible >= burn.minEvents &&
    burn.burnRate != null &&
    burn.burnRate >= burn.threshold &&
    burn.shortBurnRate != null &&
    burn.shortBurnRate >= burn.threshold
  );
}

/** The SLO is burning when either burn condition holds, alert or not. */
export function isSloBurning(burn: SloBurnStats[]): boolean {
  return burn.some(isSloBurnConditionMet);
}

/**
 * How close the rule is to holding: the highest burn rate over its
 * threshold among conditions with enough events, taking the slower of each
 * condition's two windows. At 1 or more the rule holds.
 */
export function getSloBurnSeverity(burn: SloBurnStats[]): number {
  const severity = Math.max(
    0,
    ...burn.map(c =>
      c.eligible >= c.minEvents && c.burnRate != null && c.shortBurnRate != null
        ? Math.min(c.burnRate, c.shortBurnRate) / c.threshold
        : 0,
    ),
  );
  // Down, so a value under 1 never reads as 1.
  return Math.floor(severity * 100) / 100;
}

export function deriveSloState(
  stats: Pick<SloStats, 'eligible' | 'budgetRemaining' | 'burn'>,
): SloState {
  if (stats.eligible === 0) return 'no_data';
  if (stats.budgetRemaining != null && stats.budgetRemaining <= 0) {
    return 'breached';
  }
  return isSloBurning(stats.burn) ? 'burning' : 'healthy';
}

function stateSeverity(state: SloGroupState): number {
  switch (state) {
    case 'error':
      return 5;
    case 'breached':
      return 4;
    case 'burning':
      return 3;
    case 'healthy':
      return 2;
    case 'no_data':
      return 1;
    case 'insufficient_data':
      return 0;
  }
}

/** A group with too few events has no state of its own. */
export function deriveSloGroupState(
  stats: Pick<SloStats, 'eligible' | 'budgetRemaining' | 'burn'>,
): SloGroupState {
  return stats.eligible < SLO_GROUP_MIN_EVENTS
    ? 'insufficient_data'
    : deriveSloState(stats);
}

/**
 * A grouped SLO is as bad as its worst group, since every group has its own
 * budget. Groups with too few events do not count; with none that do, the
 * SLO's overall numbers decide.
 */
export function deriveGroupedSloState(
  overall: Pick<SloStats, 'eligible' | 'budgetRemaining' | 'burn'>,
  groups: { state: SloGroupState }[],
): SloState {
  let worst: SloState | undefined;
  for (const { state } of groups) {
    if (state === 'insufficient_data') continue;
    if (worst == null || stateSeverity(state) > stateSeverity(worst)) {
      worst = state;
    }
  }
  return worst ?? deriveSloState(overall);
}

/** Worst first: by state, then by error budget left, then by value. */
export function compareSloGroupsWorstFirst(
  a: { value: string; state: SloGroupState; budgetRemaining: number | null },
  b: { value: string; state: SloGroupState; budgetRemaining: number | null },
): number {
  const byState = stateSeverity(b.state) - stateSeverity(a.state);
  if (byState !== 0) return byState;
  const budget =
    (a.budgetRemaining ?? Infinity) - (b.budgetRemaining ?? Infinity);
  if (budget !== 0 && !Number.isNaN(budget)) return budget;
  return a.value.localeCompare(b.value);
}
