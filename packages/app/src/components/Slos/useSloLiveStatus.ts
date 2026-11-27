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
  deriveSloState,
} from '@hyperdx/common-utils/dist/core/sloStats';
import type {
  SloApiResponse,
  SloState,
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
 * `end`.
 */
function useSloHistory(slo: SloApiResponse, source: TSource, end: Date) {
  const granularity = getSloHistoryGranularity(slo.window);
  const config = useMemo(
    () =>
      buildSloCountsChartConfig({
        slo,
        source,
        dateRange: getSloWindowRange(slo.window, end),
        granularity,
      }),
    [slo, source, end, granularity],
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

export type SloLiveStatus = { stats: SloStats; state: SloState };

/**
 * The SLO's numbers as of `now`, computed in the browser like its charts:
 * the window from the history buckets, the burn windows from a 6h query in
 * 5-minute buckets. Undefined until both are in.
 */
export function useSloLiveStatus(
  slo: SloApiResponse,
  source: TSource,
  now: Date,
): { live?: SloLiveStatus; error: Error | null } {
  const history = useSloHistory(slo, source, now);
  const burnConfig = useMemo(
    () => buildSloBurnChartConfig({ slo, source, now }),
    [slo, source, now],
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
    return { stats, state: deriveSloState(stats) };
  }, [history.hasData, history.buckets, burn.data, slo, now]);
  return { live, error: history.error ?? burn.error ?? null };
}
