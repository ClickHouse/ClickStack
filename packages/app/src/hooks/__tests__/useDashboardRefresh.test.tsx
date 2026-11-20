import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import { act, renderHook } from '@testing-library/react';

import {
  getRefreshIntervalOptions,
  resolveRefreshInterval,
  useDashboardRefresh,
} from '@/hooks/useDashboardRefresh';

const HOUR_MS = 60 * 60 * 1000;

function lastHours(hours: number): [Date, Date] {
  const end = new Date('2026-01-01T12:00:00Z');
  return [new Date(end.getTime() - hours * HOUR_MS), end];
}

describe('getRefreshIntervalOptions', () => {
  it('offers 30s up to the default interval', () => {
    expect(getRefreshIntervalOptions(Granularity.ThirtyMinute)).toEqual([
      Granularity.ThirtySecond,
      Granularity.OneMinute,
      Granularity.FiveMinute,
      Granularity.FifteenMinute,
      Granularity.ThirtyMinute,
    ]);
  });

  it('offers only 30s when that is the default', () => {
    expect(getRefreshIntervalOptions(Granularity.ThirtySecond)).toEqual([
      Granularity.ThirtySecond,
    ]);
  });

  it('keeps a default faster than 30s as the only choice', () => {
    expect(getRefreshIntervalOptions(Granularity.FifteenSecond)).toEqual([
      Granularity.FifteenSecond,
    ]);
  });
});

describe('resolveRefreshInterval', () => {
  it('uses the default when nothing is selected', () => {
    expect(resolveRefreshInterval(undefined, Granularity.FiveMinute)).toBe(
      Granularity.FiveMinute,
    );
  });

  it('uses a faster selection', () => {
    expect(
      resolveRefreshInterval(Granularity.OneMinute, Granularity.FiveMinute),
    ).toBe(Granularity.OneMinute);
  });

  it('falls back to the default when the selection is slower than it', () => {
    expect(
      resolveRefreshInterval(Granularity.OneHour, Granularity.FiveMinute),
    ).toBe(Granularity.FiveMinute);
  });
});

describe('useDashboardRefresh', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('refreshes at the selected interval', () => {
    const onTimeRangeSelect = jest.fn();
    const { result } = renderHook(() =>
      useDashboardRefresh({
        searchedTimeRange: lastHours(24),
        onTimeRangeSelect,
        isLive: true,
        selectedRefreshInterval: Granularity.ThirtySecond,
      }),
    );

    expect(result.current.granularityOverride).toBe(Granularity.ThirtyMinute);
    expect(result.current.refreshInterval).toBe(Granularity.ThirtySecond);

    act(() => {
      jest.advanceTimersByTime(29_000);
    });
    expect(onTimeRangeSelect).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
  });

  it('refreshes at the default interval without a selection', () => {
    const onTimeRangeSelect = jest.fn();
    const { result } = renderHook(() =>
      useDashboardRefresh({
        searchedTimeRange: lastHours(1),
        onTimeRangeSelect,
        isLive: true,
      }),
    );

    expect(result.current.refreshInterval).toBe(Granularity.OneMinute);
    expect(result.current.refreshIntervalOptions).toEqual([
      Granularity.ThirtySecond,
      Granularity.OneMinute,
    ]);

    act(() => {
      jest.advanceTimersByTime(59_000);
    });
    expect(onTimeRangeSelect).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when not live', () => {
    const onTimeRangeSelect = jest.fn();
    renderHook(() =>
      useDashboardRefresh({
        searchedTimeRange: lastHours(1),
        onTimeRangeSelect,
        isLive: false,
        selectedRefreshInterval: Granularity.ThirtySecond,
      }),
    );

    act(() => {
      jest.advanceTimersByTime(10 * 60_000);
    });
    expect(onTimeRangeSelect).not.toHaveBeenCalled();
  });

  it('keeps a fixed interval when the date range widens, unlike auto', () => {
    const { result, rerender } = renderHook(
      ({
        hours,
        selected,
      }: {
        hours: number;
        selected: Granularity | undefined;
      }) =>
        useDashboardRefresh({
          searchedTimeRange: lastHours(hours),
          onTimeRangeSelect: jest.fn(),
          isLive: true,
          selectedRefreshInterval: selected,
        }),
      {
        initialProps: {
          hours: 3,
          selected: Granularity.FiveMinute as Granularity | undefined,
        },
      },
    );

    expect(result.current.refreshInterval).toBe(Granularity.FiveMinute);
    expect(result.current.isAutoRefreshInterval).toBe(false);

    rerender({ hours: 24, selected: Granularity.FiveMinute });
    expect(result.current.refreshInterval).toBe(Granularity.FiveMinute);
    expect(result.current.isAutoRefreshInterval).toBe(false);

    rerender({ hours: 24, selected: undefined });
    expect(result.current.refreshInterval).toBe(Granularity.ThirtyMinute);
    expect(result.current.isAutoRefreshInterval).toBe(true);
  });

  it('reports auto while a fixed interval is slower than the default', () => {
    const { result } = renderHook(() =>
      useDashboardRefresh({
        searchedTimeRange: lastHours(1),
        onTimeRangeSelect: jest.fn(),
        isLive: true,
        selectedRefreshInterval: Granularity.ThirtyMinute,
      }),
    );

    expect(result.current.refreshInterval).toBe(Granularity.OneMinute);
    expect(result.current.isAutoRefreshInterval).toBe(true);
  });
});
