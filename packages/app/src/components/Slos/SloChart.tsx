import { useMemo } from 'react';
import { Label, ReferenceArea, ReferenceLine } from 'recharts';
import type { SloHistoryPoint } from '@hyperdx/common-utils/dist/core/sloStats';
import { DisplayType, NumberFormat } from '@hyperdx/common-utils/dist/types';
import { Center, Text } from '@mantine/core';

import type { LineData } from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import ChartContainer from '@/components/charts/ChartContainer';
import ChartEmptyState from '@/components/charts/ChartEmptyState';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';

export const TS_KEY = 'ts';

export const PERCENT_FORMAT: NumberFormat = { output: 'percent', mantissa: 2 };
export const RATE_FORMAT: NumberFormat = {
  output: 'number',
  mantissa: 2,
  unit: 'x',
};

// Translucent enough that the series and threshold stay readable on top.
const BAD_FILL_OPACITY = 0.12;

// A dashed line rather than a shaded area: shading everything below a 99.9%
// target would cover the whole plot and pin the axis at zero.
export function thresholdLine(value: number, label: string, color: string) {
  return (
    <ReferenceLine
      y={value}
      stroke={color}
      strokeDasharray="4 4"
      ifOverflow="extendDomain"
    >
      <Label
        value={label}
        position="insideTopLeft"
        fill={color}
        fontSize={11}
      />
    </ReferenceLine>
  );
}

/**
 * Runs of consecutive buckets where `isBad` holds, as [start, end] in seconds
 * on the chart's time axis. Each bucket covers its start plus one bucket.
 */
export function badPeriods(
  points: SloHistoryPoint[],
  bucketSeconds: number,
  isBad: (point: SloHistoryPoint) => boolean,
): [number, number][] {
  const periods: [number, number][] = [];
  for (const point of points) {
    if (!isBad(point)) continue;
    const start = point.ts / 1000;
    const last = periods[periods.length - 1];
    if (last != null && start <= last[1]) {
      last[1] = start + bucketSeconds;
    } else {
      periods.push([start, start + bucketSeconds]);
    }
  }
  return periods;
}

/** Shaded columns for the periods a series spent in a bad state. */
export function badPeriodAreas(periods: [number, number][], color: string) {
  return periods.map(([x1, x2]) => (
    <ReferenceArea
      key={`bad-${x1}`}
      x1={x1}
      x2={x2}
      fill={color}
      fillOpacity={BAD_FILL_OPACITY}
      strokeOpacity={0}
      ifOverflow="hidden"
    />
  ));
}

/**
 * Shades everything below zero, where an error budget is overspent, once the
 * budget gets there. The lower edge reaches past the lowest value and is
 * clipped to the plot, so the shading runs to the bottom of the axis.
 */
export function overspentZone(points: SloHistoryPoint[], color: string) {
  const lowest = Math.min(...points.map(p => p.budgetRemaining ?? 0), 0);
  if (lowest >= 0) return null;
  return (
    <ReferenceArea
      y1={lowest * 10}
      y2={0}
      fill={color}
      fillOpacity={BAD_FILL_OPACITY}
      strokeOpacity={0}
      ifOverflow="hidden"
    >
      <Label
        value="Overspent"
        position="insideTopLeft"
        fill={color}
        fontSize={11}
      />
    </ReferenceArea>
  );
}

export function seriesLine(key: string, name: string, color: string): LineData {
  return {
    dataKey: key,
    currentPeriodKey: key,
    previousPeriodKey: `${key}__previous`,
    displayName: name,
    valueColumnName: key,
    groupValues: [],
    color,
  };
}

/**
 * One SLO history chart. Clicking a bucket reports its start, for the
 * bad events of that bucket.
 */
export function SloChart({
  title,
  rows,
  lines,
  dateRange,
  granularity,
  numberFormat,
  referenceLines,
  referenceLineValues,
  fitYAxisToData,
  isLoading,
  error,
  onBucketClick,
  displayType = DisplayType.Line,
}: {
  title: string;
  rows: Record<string, number | null>[];
  lines: LineData[];
  dateRange: [Date, Date];
  granularity: string;
  numberFormat: NumberFormat;
  referenceLines?: React.ReactNode;
  referenceLineValues?: number[];
  fitYAxisToData?: boolean;
  isLoading: boolean;
  error?: Error | null;
  onBucketClick: (bucketStartMs: number) => void;
  displayType?: DisplayType;
}) {
  const formats = useMemo(
    () => new Map(lines.map(line => [line.dataKey, numberFormat])),
    [lines, numberFormat],
  );
  const chart = error ? (
    <Center h="100%" px="md">
      <Text size="xs" c="var(--color-text-danger)" ta="center">
        Could not load the history: {error.message}
      </Text>
    </Center>
  ) : !isLoading && rows.length === 0 ? (
    <ChartEmptyState />
  ) : (
    <MemoChart
      graphResults={rows}
      lineData={lines}
      dateRange={dateRange}
      granularity={granularity}
      timestampKey={TS_KEY}
      isLoading={isLoading}
      // A click opens the bucket's bad events instead of pinning a tooltip.
      isClickActive={undefined}
      setIsClickActive={payload => {
        if (payload) onBucketClick(Number(payload.activeLabel) * 1000);
      }}
      tooltipNumberFormatsByKey={formats}
      axisNumberFormat={numberFormat}
      referenceLines={referenceLines}
      referenceLineValues={referenceLineValues}
      showLegend={false}
      fitYAxisToData={fitYAxisToData}
      compactXAxisLabels
      displayType={displayType}
      dateRangeEndInclusive={false}
    />
  );
  return (
    <ChartCard style={{ height: 260 }}>
      <ChartContainer title={title}>{chart}</ChartContainer>
    </ChartCard>
  );
}
