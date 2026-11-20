import {
  formatRelativeDuration,
  getSavedSearchLanding,
  getSaveTimeRangeOutcome,
  hasExplicitTimeParams,
  isLiveTailDuration,
  isRangeEndingNow,
  toDefaultTimeRange,
} from '@/components/SavedSearches/savedSearchTimeRange';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0, 500);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ONE_DAY = { type: 'relative' as const, value: 86400 };
const ONE_HOUR = { type: 'relative' as const, value: 3600 };

const windowEndingAt = (end: number, durationMs: number): [Date, Date] => [
  new Date(end - durationMs),
  new Date(end),
];

describe('hasExplicitTimeParams', () => {
  it.each([
    ['', false],
    ['?source=abc&where=x', false],
    ['?from=1&to=2', false],
    ['?from=1&to=2&isLive=false', true],
    ['?isLive=true', true],
    ['?liveInterval=300000', true],
  ])('%s -> %s', (search, expected) => {
    expect(hasExplicitTimeParams(search)).toBe(expected);
  });
});

describe('isLiveTailDuration', () => {
  it.each([
    [MINUTE, true],
    [HOUR, true],
    [6 * HOUR, true],
    [12 * HOUR, false],
    [DAY, false],
    [90 * MINUTE, false],
  ])('%i ms -> %s', (durationMs, expected) => {
    expect(isLiveTailDuration(durationMs)).toBe(expected);
  });
});

describe('getSavedSearchLanding', () => {
  it('opens a range live tail supports as live tail with that interval', () => {
    expect(getSavedSearchLanding(ONE_HOUR, '', NOW)).toEqual({
      kind: 'live',
      intervalMs: HOUR,
    });
  });

  it('opens a longer range as a window ending at the current second', () => {
    const end = NOW - 500;
    expect(getSavedSearchLanding(ONE_DAY, '', NOW)).toEqual({
      kind: 'window',
      range: [new Date(end - DAY), new Date(end)],
    });
  });

  it('yields to a time already in the URL', () => {
    expect(
      getSavedSearchLanding(ONE_DAY, '?from=1&to=2&isLive=false', NOW),
    ).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
  ])('ignores a %s range', (_name, stored) => {
    expect(getSavedSearchLanding(stored, '', NOW)).toBeNull();
  });
});

describe('toDefaultTimeRange', () => {
  it('snaps to a preset within one second', () => {
    expect(toDefaultTimeRange(DAY + 800)).toEqual(ONE_DAY);
  });

  it('rounds other durations to whole seconds', () => {
    expect(toDefaultTimeRange(90 * MINUTE + 400)).toEqual({
      type: 'relative',
      value: 5400,
    });
  });
});

describe('isRangeEndingNow', () => {
  it('allows at least a minute of slack', () => {
    expect(
      isRangeEndingNow(windowEndingAt(NOW - 59 * SECOND, MINUTE), NOW),
    ).toBe(true);
    expect(
      isRangeEndingNow(windowEndingAt(NOW - 61 * SECOND, MINUTE), NOW),
    ).toBe(false);
  });

  it('allows 10% of the duration for long windows', () => {
    const twoHoursAgo = NOW - 2 * 60 * MINUTE;
    expect(isRangeEndingNow(windowEndingAt(twoHoursAgo, DAY), NOW)).toBe(true);
  });

  it('rejects a window that ended in the past', () => {
    const oct2 = Date.UTC(2026, 9, 2);
    expect(isRangeEndingNow(windowEndingAt(oct2, DAY), NOW)).toBe(false);
  });
});

describe('formatRelativeDuration', () => {
  it.each([
    [86400, '1 day'],
    [5400, '1 hour 30 minutes'],
    [30 * 86400, '30 days'],
  ])('%i -> %s', (seconds, expected) => {
    expect(formatRelativeDuration(seconds)).toBe(expected);
  });
});

describe('getSaveTimeRangeOutcome', () => {
  const live = (intervalMs: number) => ({ kind: 'live' as const, intervalMs });
  const window = (range: [Date, Date]) => ({ kind: 'window' as const, range });
  const outcome = (
    current: ReturnType<typeof live> | ReturnType<typeof window>,
    stored: typeof ONE_DAY | typeof ONE_HOUR | null,
    isUpdate: boolean,
  ) => getSaveTimeRangeOutcome({ current, stored, isUpdate, nowMs: NOW });

  it('saves a live tail interval picked in the time picker', () => {
    expect(outcome(live(HOUR), null, false)).toEqual({
      value: ONE_HOUR,
      opensWith: ONE_HOUR,
    });
  });

  it('saves a window that ends now', () => {
    expect(outcome(window(windowEndingAt(NOW, DAY)), ONE_HOUR, true)).toEqual({
      value: ONE_DAY,
      opensWith: ONE_DAY,
    });
  });

  it('stores nothing for default live tail, and clears a stored range on update', () => {
    expect(outcome(live(15 * MINUTE), null, false)).toEqual({
      value: undefined,
      opensWith: null,
    });
    expect(outcome(live(15 * MINUTE), ONE_DAY, true)).toEqual({
      value: null,
      opensWith: null,
    });
  });

  it('keeps the stored range when an update is made on a window in the past', () => {
    const brushed = window(windowEndingAt(NOW - 3 * HOUR, 10 * MINUTE));
    expect(outcome(brushed, ONE_DAY, true)).toEqual({
      value: undefined,
      opensWith: ONE_DAY,
    });
    expect(outcome(brushed, ONE_DAY, false)).toEqual({
      value: undefined,
      opensWith: null,
    });
  });
});
