import { getSloBurnRule, type SloBurnCounts } from '@/core/slo';
import {
  compareSloGroupsWorstFirst,
  computeSloBurnRate,
  computeSloBurnStats,
  computeSloGroupBurnFromRows,
  computeSloStats,
  deriveGroupedSloState,
  deriveSloGroupState,
  deriveSloState,
  getSloBurnSeverity,
  isSloBurnConditionMet,
  isSloBurning,
} from '@/core/sloStats';
import type { SloBurnStats } from '@/slo';

// 1h at 14.4x and 6h at 6x for a 30-day SLO.
const rule = getSloBurnRule('30d');

const burnCounts = (partial: Partial<SloBurnCounts>): SloBurnCounts => ({
  eligible: 0,
  good: 0,
  shortEligible: 0,
  shortGood: 0,
  ...partial,
});

/** The 1h condition with the given rates and events. */
const hour = (partial: Partial<SloBurnStats>): SloBurnStats => ({
  ...rule[0],
  eligible: 1000,
  bad: 0,
  burnRate: 0,
  shortBurnRate: 0,
  ...partial,
});

describe('SLO stats', () => {
  it('derives bad events as eligible minus good', () => {
    // 1000 eligible, 990 good: 10 bad against a 99.5% target.
    const burn = computeSloBurnStats(
      [burnCounts({ eligible: 100, good: 98 })],
      rule,
      99.5,
    );
    const stats = computeSloStats({ eligible: 1000, good: 990 }, burn, 99.5);
    expect(stats.bad).toBe(10);
    expect(stats.sli).toBeCloseTo(0.99);
    expect(stats.errorBudget).toBeCloseTo(5);
    expect(stats.budgetRemaining).toBeCloseTo(-1);
    expect(stats.burn[0].burnRate).toBeCloseTo(4);
    // A condition without counts reads as no burn.
    expect(stats.burn[1]).toMatchObject({ window: '6h', burnRate: null });
    expect(deriveSloState(stats)).toBe('breached');
  });

  it('computes the burn rate as a multiple of the allowed bad rate', () => {
    // 10 bad of 1000 against a 0.5% budget: 1% bad is a 2x burn.
    expect(computeSloBurnRate(1000, 990, 99.5)).toBeCloseTo(2);
    expect(computeSloBurnRate(0, 0, 99.5)).toBeNull();
    // More good than eligible (late rows) never reads as a negative burn.
    expect(computeSloBurnRate(10, 12, 99.5)).toBe(0);
  });

  it('separates no data, healthy and burning', () => {
    expect(
      deriveSloState(computeSloStats({ eligible: 0, good: 0 }, [], 99.9)),
    ).toBe('no_data');
    // 2% bad in both windows of the 1h condition against a 0.1% budget: a
    // 20x burn.
    const burn = computeSloBurnStats(
      [
        burnCounts({
          eligible: 1000,
          good: 980,
          shortEligible: 100,
          shortGood: 98,
        }),
      ],
      rule,
      99.9,
    );
    const burning = computeSloStats(
      { eligible: 1_000_000, good: 999_500 },
      burn,
      99.9,
    );
    expect(burning.budgetRemaining).toBeGreaterThan(0);
    expect(deriveSloState(burning)).toBe('burning');
    const calm = computeSloBurnStats([], rule, 99.9);
    expect(deriveSloState({ ...burning, burn: calm })).toBe('healthy');
  });
});

describe('SLO burn-rate rule', () => {
  it('scales the thresholds to the SLO window', () => {
    expect(rule.map(c => [c.window, c.shortWindow, c.threshold])).toEqual([
      ['1h', '5m', 14.4],
      ['6h', '30m', 6],
    ]);
    expect(getSloBurnRule('7d').map(c => c.threshold)).toEqual([3.36, 1.4]);
  });

  it('needs both windows of a condition at or above its threshold', () => {
    expect(
      isSloBurnConditionMet(hour({ burnRate: 20, shortBurnRate: 15 })),
    ).toBe(true);
    // The burn stopped: the long window still remembers it, the short one
    // does not, so the condition (and the alert) stops holding.
    expect(
      isSloBurnConditionMet(hour({ burnRate: 20, shortBurnRate: 0 })),
    ).toBe(false);
    // No events in the short window is not a burn either.
    expect(
      isSloBurnConditionMet(hour({ burnRate: 20, shortBurnRate: null })),
    ).toBe(false);
  });

  it('needs enough events in the long window', () => {
    const fast = { burnRate: 100, shortBurnRate: 100 };
    expect(isSloBurnConditionMet(hour({ ...fast, eligible: 10 }))).toBe(false);
    expect(isSloBurnConditionMet(hour({ ...fast, eligible: 20 }))).toBe(true);
  });

  it('holds when either condition does', () => {
    const slowBurn: SloBurnStats = {
      ...rule[1],
      eligible: 6000,
      bad: 42,
      burnRate: 7,
      shortBurnRate: 6.5,
    };
    // 7x for 6 hours misses the 1h condition's 14.4x and meets the 6h one.
    expect(
      isSloBurning([hour({ burnRate: 7, shortBurnRate: 7 }), slowBurn]),
    ).toBe(true);
    expect(isSloBurning([hour({ burnRate: 7, shortBurnRate: 7 })])).toBe(false);
  });

  it('measures how close the rule is to holding', () => {
    // The slower window of a condition over its threshold, the highest wins.
    expect(
      getSloBurnSeverity([hour({ burnRate: 21.6, shortBurnRate: 14.4 })]),
    ).toBe(1);
    expect(
      getSloBurnSeverity([hour({ burnRate: 7.2, shortBurnRate: 9 })]),
    ).toBe(0.5);
    // Not enough events, or none, counts for nothing.
    expect(
      getSloBurnSeverity([
        hour({ eligible: 5, burnRate: 100, shortBurnRate: 100 }),
      ]),
    ).toBe(0);
    expect(getSloBurnSeverity([])).toBe(0);
    // Just under the threshold never rounds up to holding.
    expect(
      getSloBurnSeverity([hour({ burnRate: 14.39, shortBurnRate: 14.39 })]),
    ).toBe(0.99);
  });
});

describe('SLO groups', () => {
  const burning = [hour({ burnRate: 20, shortBurnRate: 20 })];
  const stats = (
    eligible: number,
    budgetRemaining: number,
    burn = calmBurn,
  ) => ({
    eligible,
    budgetRemaining,
    burn,
  });
  const calmBurn = [hour({})];

  it('gives a group a state once it has enough events', () => {
    expect(deriveSloGroupState(stats(99, 0.5, burning))).toBe(
      'insufficient_data',
    );
    expect(deriveSloGroupState(stats(100, 0.5, burning))).toBe('burning');
  });

  it('rates a grouped SLO by its worst group that has enough events', () => {
    const overall = stats(10_000, 0.9);
    expect(
      deriveGroupedSloState(overall, [
        { state: 'healthy' },
        { state: 'burning' },
        // Too few events to count, however bad.
        { state: 'insufficient_data' },
      ]),
    ).toBe('burning');
    // No group with enough events: the overall numbers decide.
    expect(
      deriveGroupedSloState(stats(10_000, -0.1), [
        { state: 'insufficient_data' },
      ]),
    ).toBe('breached');
    expect(deriveGroupedSloState(overall, [])).toBe('healthy');
  });

  it("computes each group's burn, with none for a group without events", () => {
    const now = new Date('2026-11-01T01:07:00Z');
    // Twelve 5-minute buckets ending where the burn query ends, 01:05.
    const rows = Array.from({ length: 12 }, (_, i) => ({
      slo_group: 'checkout',
      __hdx_time_bucket: new Date(
        Date.parse('2026-11-01T00:05:00Z') + i * 5 * 60_000,
      ).toISOString(),
      slo_eligible: '100',
      slo_good: '90',
    }));
    const burn = computeSloGroupBurnFromRows(
      rows,
      { window: '30d', target: 99.5 },
      now,
      ['checkout', 'cart'],
    );
    expect([...burn.keys()]).toEqual(['checkout', 'cart']);
    expect(burn.get('checkout')?.[0]).toMatchObject({
      window: '1h',
      eligible: 1200,
      bad: 120,
      burnRate: expect.closeTo(20),
    });
    expect(burn.get('cart')?.[0]).toMatchObject({
      eligible: 0,
      burnRate: null,
    });
  });

  it('orders groups worst first', () => {
    const groups = [
      { value: 'a', state: 'healthy' as const, budgetRemaining: 0.9 },
      {
        value: 'b',
        state: 'insufficient_data' as const,
        budgetRemaining: null,
      },
      { value: 'c', state: 'breached' as const, budgetRemaining: -0.2 },
      { value: 'd', state: 'healthy' as const, budgetRemaining: 0.3 },
    ];
    expect(
      [...groups].sort(compareSloGroupsWorstFirst).map(g => g.value),
    ).toEqual(['c', 'd', 'a', 'b']);
  });
});
