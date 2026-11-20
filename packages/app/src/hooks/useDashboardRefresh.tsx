'use client';

import React from 'react';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  Granularity,
} from '@hyperdx/common-utils/dist/core/utils';
import { useDocumentVisibility } from '@mantine/hooks';

const MIN_REFRESH_INTERVAL_SECONDS = 30;

// Every interval convertDateRangeToGranularityString can return at or above the
// minimum, so the date range's default interval is always one of the choices.
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
 * Refresh intervals a live dashboard offers, fastest first: from 30s up to the
 * date range's default interval. A default faster than 30s is the only choice.
 */
export function getRefreshIntervalOptions(
  defaultInterval: Granularity,
): Granularity[] {
  const maxSeconds = convertGranularityToSeconds(defaultInterval);
  if (maxSeconds < MIN_REFRESH_INTERVAL_SECONDS) {
    return [defaultInterval];
  }
  return REFRESH_INTERVAL_CHOICES.filter(
    interval => convertGranularityToSeconds(interval) <= maxSeconds,
  );
}

/** The chosen interval while it is still offered, otherwise the default. */
export function resolveRefreshInterval(
  selected: Granularity | undefined,
  defaultInterval: Granularity,
): Granularity {
  return selected != null &&
    getRefreshIntervalOptions(defaultInterval).includes(selected)
    ? selected
    : defaultInterval;
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
  /** Overrides the date range's default refresh interval while it is offered. */
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
    // eslint-disable-next-line no-restricted-syntax
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
  const refreshInterval = resolveRefreshInterval(
    selectedRefreshInterval,
    granularityOverride,
  );

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
        convertGranularityToSeconds(refreshInterval) * 1000,
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
  };
};
