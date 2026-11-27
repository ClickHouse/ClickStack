import { useEffect, useMemo, useState } from 'react';
import {
  buildSloBurnChartConfig,
  buildSloCountsChartConfig,
  getSloHistoryGranularity,
  getSloWindowRange,
  parseSloHistoryRows,
  sumSloBuckets,
} from '@hyperdx/common-utils/dist/core/slo';
import {
  computeSloBurnFromRows,
  computeSloStats,
  deriveSloGroupState,
  deriveSloState,
} from '@hyperdx/common-utils/dist/core/sloStats';
import type {
  SloApiResponse,
  SloGroupState,
  SloStats,
} from '@hyperdx/common-utils/dist/slo';
import type { TSource } from '@hyperdx/common-utils/dist/types';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';

/** How often an open SLO page moves its window forward. */
const SLO_LIVE_REFRESH_MS = 5 * 60 * 1000;

/** The current time, moved forward every few minutes. */
export function useSloNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), SLO_LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Eligible and good events per bucket over the SLO window that ends at
 * `end`, for one group of a grouped SLO when `group` is set. The charts and
 * the numbers above them share this query, so they describe the same moment
 * and the page reads the window once.
 */
export function useSloHistory(
  slo: SloApiResponse,
  source: TSource,
  end: Date,
  group?: string,
) {
  const granularity = getSloHistoryGranularity(slo.window);
  const config = useMemo(
    () =>
      buildSloCountsChartConfig({
        slo,
        source,
        dateRange: getSloWindowRange(slo.window, end),
        granularity,
        scope: group != null ? { group } : undefined,
      }),
    [slo, source, end, granularity, group],
  );
  const { data, isLoading, error } = useQueriedChartConfig(config, {
    queryKeyPrefix: 'slo-history',
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const buckets = useMemo(() => parseSloHistoryRows(data?.data ?? []), [data]);
  return {
    config,
    granularity,
    buckets,
    hasData: data != null,
    isLoading: isLoading && data == null,
    error,
  };
}

export type SloLiveStatus = { stats: SloStats; state: SloGroupState };

/**
 * The SLO's numbers as of `now`, or one group's, computed in the browser
 * like its charts: the window from the history buckets, the burn windows
 * from a 6h query in 5-minute buckets. Undefined until both are in.
 */
export function useSloLiveStatus(
  slo: SloApiResponse,
  source: TSource,
  now: Date,
  group?: string,
): { live?: SloLiveStatus; error: Error | null } {
  const history = useSloHistory(slo, source, now, group);
  const burnConfig = useMemo(
    () =>
      buildSloBurnChartConfig({
        slo,
        source,
        now,
        scope: group != null ? { group } : undefined,
      }),
    [slo, source, now, group],
  );
  const burn = useQueriedChartConfig(burnConfig, {
    queryKeyPrefix: 'slo-burn',
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const live = useMemo(() => {
    if (!history.hasData || burn.data == null) return undefined;
    const stats = computeSloStats(
      sumSloBuckets(history.buckets),
      computeSloBurnFromRows(burn.data.data, slo, now),
      slo.target,
    );
    return {
      stats,
      state: group != null ? deriveSloGroupState(stats) : deriveSloState(stats),
    };
  }, [history.hasData, history.buckets, burn.data, slo, now, group]);
  return { live, error: history.error ?? burn.error ?? null };
}
