import { getSloBurnRule, type SloBurnCounts } from '@/core/slo';
import {
  compareSloGroupsWorstFirst,
  compareSlosWorstFirst,
  computeSloBurnRate,
  computeSloBurnStats,
  computeSloGroupBurnFromRows,
  computeSloHistory,
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

const HOUR_MS = 60 * 60 * 1000;

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

describe('SLO history', () => {
  it('builds a burndown that ends at the budget left', () => {
    const points = computeSloHistory(
      [
        { ts: 0, eligible: 1000, good: 1000 },
        { ts: HOUR_MS, eligible: 1000, good: 990 },
      ],
      { target: 99, bucketMs: HOUR_MS, burnWindowMs: HOUR_MS },
    );
    expect(points[0].budgetRemaining).toBeCloseTo(1);
    expect(points[1].budgetRemaining).toBeCloseTo(0.5);
    expect(points[1].burnRate).toBeCloseTo(1);
  });

  it('reads the burn rate over the trailing burn window', () => {
    // Hourly buckets against a 6 hour window: the bad hour keeps counting
    // until it is more than 6 hours old, like the slow alert sees it.
    const buckets = Array.from({ length: 8 }, (_, i) => ({
      ts: i * HOUR_MS,
      eligible: 100,
      good: i === 0 ? 40 : 100,
    }));
    const points = computeSloHistory(buckets, {
      target: 99,
      bucketMs: HOUR_MS,
      burnWindowMs: 6 * HOUR_MS,
    });
    // 60 bad of 100 in the first hour: 60x against a 1% budget.
    expect(points[0].burnRate).toBeCloseTo(60);
    // 60 bad of 600 over six hours: 10x.
    expect(points[5].burnRate).toBeCloseTo(10);
    // The bad hour has left the window.
    expect(points[6].burnRate).toBeCloseTo(0);
  });

  it('measures the trailing window in time, not in buckets', () => {
    // A missing bucket (no events) must not stretch the window.
    const points = computeSloHistory(
      [
        { ts: 0, eligible: 100, good: 0 },
        { ts: 3 * HOUR_MS, eligible: 100, good: 100 },
      ],
      { target: 99, bucketMs: HOUR_MS, burnWindowMs: 2 * HOUR_MS },
    );
    expect(points[1].burnRate).toBeCloseTo(0);
  });
});

describe('SLO ordering', () => {
  it('orders SLOs worst first', () => {
    const slo = (
      name: string,
      state: 'healthy' | 'breached' | 'burning',
      budget: number,
    ) => ({
      name,
      status: { state, budgetRemaining: budget },
    });
    const sorted = [
      slo('a', 'healthy', 0.9),
      slo('b', 'breached', -0.5),
      slo('c', 'burning', 0.4),
      slo('d', 'breached', -2),
    ].sort(compareSlosWorstFirst);
    expect(sorted.map(s => s.name)).toEqual(['d', 'b', 'c', 'a']);
  });
});
