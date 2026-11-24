import { useMemo } from 'react';
import { getSloBurnRule } from '@hyperdx/common-utils/dist/core/slo';
import { computeSloHistory } from '@hyperdx/common-utils/dist/core/sloStats';
import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import {
  getSloBurnWindowMs,
  type SloApiResponse,
} from '@hyperdx/common-utils/dist/slo';
import { DisplayType, type TSource } from '@hyperdx/common-utils/dist/types';
import { SimpleGrid, Stack, Text } from '@mantine/core';

import { useFormatTime } from '@/useFormatTime';
import {
  getChartColorError,
  getChartColorInfo,
  getChartColorWarning,
} from '@/utils';

import {
  badPeriodAreas,
  badPeriods,
  overspentZone,
  PERCENT_FORMAT,
  RATE_FORMAT,
  seriesLine,
  SloChart,
  thresholdLine,
  TS_KEY,
} from './SloChart';
import { describeBurnWindow, formatSloWindow } from './sloUtils';
import { useSloHistory } from './useSloLiveStatus';

/** "hour" or "30 minutes", for "per ..." titles. */
const describeBucket = (granularity: string) =>
  granularity === '1 hour' ? 'hour' : granularity.replace('minute', 'minutes');

/**
 * SLI, budget burndown and burn rate over the SLO window, from bucketed
 * counts queried in the browser like any chart. The window ends at `now`,
 * as the numbers above the charts do, so both describe the same moment.
 * Clicking a bucket opens its bad events.
 */
export function SloCharts({
  slo,
  source,
  now,
  onBucketSelect,
}: {
  slo: SloApiResponse;
  source: TSource;
  now: Date;
  onBucketSelect: (start: Date, end: Date) => void;
}) {
  const formatTime = useFormatTime();
  const { config, granularity, buckets, isLoading, error } = useSloHistory(
    slo,
    source,
    now,
  );
  const bucketMs = convertGranularityToSeconds(granularity) * 1000;
  // The burn chart follows the rule's 1h condition, the one that pages first.
  const burn = getSloBurnRule(slo.window)[0];
  const points = useMemo(
    () =>
      computeSloHistory(buckets, {
        target: slo.target,
        bucketMs,
        burnWindowMs: getSloBurnWindowMs(burn.window),
      }),
    [buckets, slo.target, bucketMs, burn.window],
  );
  // Start the axis where data starts: a source younger than the SLO window
  // would otherwise squeeze every point against the right edge.
  const dateRange = useMemo<[Date, Date]>(() => {
    const [start, end] = config.dateRange;
    const firstBucket = buckets[0]?.ts ?? start.getTime();
    return [new Date(Math.max(start.getTime(), firstBucket)), end];
  }, [config, buckets]);

  const rows = useMemo(
    () =>
      points.map(p => ({
        [TS_KEY]: p.ts / 1000,
        sli: p.sli,
        budget: p.budgetRemaining,
        // Two series, so buckets at or over the threshold stand out in red.
        burn:
          p.burnRate != null && p.burnRate < burn.threshold ? p.burnRate : null,
        burn_high:
          p.burnRate != null && p.burnRate >= burn.threshold
            ? p.burnRate
            : null,
      })),
    [points, burn.threshold],
  );
  // Chart colors come from CSS variables, so series are built on mount to
  // follow the theme, and kept stable for the memoized charts.
  const lines = useMemo(
    () => ({
      sli: [seriesLine('sli', 'SLI', getChartColorInfo())],
      budget: [seriesLine('budget', 'Budget left', getChartColorWarning())],
      burn: [
        seriesLine('burn', 'Burn rate', getChartColorInfo()),
        seriesLine(
          'burn_high',
          'Burn rate at or over the threshold',
          getChartColorError(),
        ),
      ],
    }),
    [],
  );
  const belowTarget = badPeriods(
    points,
    bucketMs / 1000,
    p => p.sli != null && p.sli * 100 < slo.target,
  );

  const common = {
    dateRange,
    granularity,
    isLoading,
    error,
    onBucketClick: (start: number) =>
      onBucketSelect(new Date(start), new Date(start + bucketMs)),
  };
  const bucket = describeBucket(granularity);

  return (
    <Stack gap="xs" data-testid="slo-charts">
      <Text size="xs" c="dimmed">
        The last {formatSloWindow(slo.window)}
        {buckets.length > 0 && dateRange[0] > config.dateRange[0]
          ? `, with data from ${formatTime(dateRange[0], { format: 'short' })}`
          : ''}
        . Click a bucket to see its bad events.
      </Text>
      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <SloChart
          {...common}
          title={`SLI per ${bucket} (target ${slo.target}%)`}
          rows={rows}
          lines={lines.sli}
          numberFormat={PERCENT_FORMAT}
          referenceLines={
            <>
              {badPeriodAreas(belowTarget, getChartColorError())}
              {thresholdLine(
                slo.target / 100,
                `Target ${slo.target}%`,
                getChartColorWarning(),
              )}
            </>
          }
          referenceLineValues={[slo.target / 100]}
          fitYAxisToData
        />
        <SloChart
          {...common}
          title={`Error budget left (${formatSloWindow(slo.window)})`}
          rows={rows}
          lines={lines.budget}
          numberFormat={PERCENT_FORMAT}
          referenceLines={overspentZone(points, getChartColorError())}
        />
        <SloChart
          {...common}
          title={`Burn rate over ${describeBurnWindow(burn.window)}, per ${bucket}`}
          rows={rows}
          lines={lines.burn}
          numberFormat={RATE_FORMAT}
          referenceLines={thresholdLine(
            burn.threshold,
            `Threshold ${burn.threshold}x`,
            getChartColorError(),
          )}
          referenceLineValues={[burn.threshold]}
          displayType={DisplayType.StackedBar}
        />
      </SimpleGrid>
    </Stack>
  );
}
