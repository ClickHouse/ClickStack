'use client';

import React from 'react';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  Granularity,
} from '@hyperdx/common-utils/dist/core/utils';
import { useDocumentVisibility } from '@mantine/hooks';

// setInterval treats longer delays as 0 and would refresh in a tight loop.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

// The intervals convertDateRangeToGranularityString can return, minus 15s
// (refreshes stay at 30s or slower), so a default of 30s or more is always one
// of the choices.
const REFRESH_INTERVAL_CHOICES = [
  Granularity.ThirtySecond,
  Granularity.OneMinute,
  Granularity.FiveMinute,
  Granularity.FifteenMinute,
  Granularity.ThirtyMinute,
  Granularity.OneHour,
  Granularity.TwoHour,
  Granularity.SixHour,
  Granularity.TwelveHour,
  Granularity.OneDay,
  Granularity.TwoDay,
  Granularity.SevenDay,
  Granularity.ThirtyDay,
];

/**
 * Fixed refresh intervals a live dashboard offers, fastest first: from 30s up
 * to the date range's default interval. Empty when the default is under 30s.
 */
export function getRefreshIntervalOptions(
  defaultInterval: Granularity,
): Granularity[] {
  const maxSeconds = convertGranularityToSeconds(defaultInterval);
  return REFRESH_INTERVAL_CHOICES.filter(
    interval => convertGranularityToSeconds(interval) <= maxSeconds,
  );
}

export const useDashboardRefresh = ({
  searchedTimeRange,
  onTimeRangeSelect,
  isLive,
  selectedRefreshInterval,
}: {
  onTimeRangeSelect: (start: Date, end: Date) => void;
  searchedTimeRange: [Date, Date];
  isLive: boolean;
  /**
   * Fixed refresh interval, used while the date range still offers it.
   * Undefined follows the date range's default.
   */
  selectedRefreshInterval?: Granularity;
}) => {
  const [manualRefreshCooloff, setManualRefreshCooloff] = React.useState(false);

  const isTabVisible = useDocumentVisibility() === 'visible';

  const isRefreshEnabled = React.useMemo(() => {
    return isTabVisible && isLive;
  }, [isTabVisible, isLive]);

  const refresh = React.useCallback(() => {
    const timeDiff =
      searchedTimeRange[1].getTime() - searchedTimeRange[0].getTime();
    const timeDiffRoundedToSecond = Math.round(timeDiff / 1000) * 1000;
    const newEnd = new Date();
    const newStart = new Date(newEnd.getTime() - timeDiffRoundedToSecond);
    onTimeRangeSelect(newStart, newEnd);
    setManualRefreshCooloff(true);
    setTimeout(() => {
      setManualRefreshCooloff(false);
    }, 1000);
  }, [onTimeRangeSelect, searchedTimeRange]);

  const granularityOverride =
    convertDateRangeToGranularityString(searchedTimeRange);

  const refreshIntervalOptions = React.useMemo(
    () => getRefreshIntervalOptions(granularityOverride),
    [granularityOverride],
  );
  // A fixed interval the date range no longer offers falls back to auto but
  // stays selected, so widening the range restores it.
  const fixedRefreshInterval =
    selectedRefreshInterval != null &&
    refreshIntervalOptions.includes(selectedRefreshInterval)
      ? selectedRefreshInterval
      : undefined;
  const isAutoRefreshInterval = fixedRefreshInterval == null;
  const refreshInterval = fixedRefreshInterval ?? granularityOverride;

  // Auto-refresh interval
  const intervalRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (isRefreshEnabled) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      intervalRef.current = window.setInterval(
        () => {
          refresh();
        },
        Math.min(
          convertGranularityToSeconds(refreshInterval) * 1000,
          MAX_TIMER_DELAY_MS,
        ),
      );
    } else {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    }
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, [isRefreshEnabled, refreshInterval, refresh]);

  return {
    granularityOverride,
    isRefreshEnabled,
    manualRefreshCooloff,
    refresh,
    refreshInterval,
    refreshIntervalOptions,
    isAutoRefreshInterval,
  };
};
