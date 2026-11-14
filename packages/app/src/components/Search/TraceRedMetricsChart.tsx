import { type CSSProperties, useMemo, useState } from 'react';
import {
  BuilderChartConfigWithDateRange,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { Flex, SegmentedControl } from '@mantine/core';

import { IsolatedChartSyncProvider } from '@/chartSync';
import { ChartCard } from '@/components/charts/ChartCard';
import { DBTimeChart, type SeriesGroupFilter } from '@/components/DBTimeChart';

import {
  durationConfig,
  ERROR_RATE_HELPER_SERIES,
  errorsConfig,
  ErrorsMode,
  redBaseConfig,
} from './traceRedMetrics';

// Each RED tile is a ChartCard flex child that fills its column; ChartCard
// supplies the dashboard-tile chrome (border, background, full-bleed header
// divider) and the card-header context, so the three headers line up on their
// own without any manual height pinning.
const RED_TILE_STYLE = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  height: '100%',
} satisfies CSSProperties;

/**
 * RED metrics (Throughput, Errors, Duration) for the trace search results view,
 * replacing the single count histogram. The three charts render side by side as
 * sibling DBTimeCharts under a shared sync scope, so hovering one shows a
 * cross-chart cursor on all three at the same timestamp.
 *
 * The per-chart aggregations are built by ./traceRedMetrics from the same base
 * config the histogram uses, so all three honor the active WHERE filter and
 * selected time range.
 */
export function TraceRedMetricsChart({
  histogramTimeChartConfig,
  source,
  isReady,
  queryKeyPrefix,
  throughputQueryKeyPrefix,
  onTimeRangeSelect,
  onFocusSeries,
}: {
  /** The count-histogram config; RED charts spread this and swap only select. */
  histogramTimeChartConfig: BuilderChartConfigWithDateRange;
  source: TTraceSource;
  isReady: boolean;
  /** Query-key prefix for the auxiliary Errors/Duration tiles, kept separate so
   * their slow quantile scans stay out of the reported search latency. */
  queryKeyPrefix?: string;
  /** Query-key prefix for the Throughput tile. It is the status-grouped count
   * histogram this view replaces, so passing the results header's prefix here
   * lets react-query dedupe the two into a single scan. */
  throughputQueryKeyPrefix?: string;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  /** Filter the results by a clicked status series, matching the histogram's
   * per-status drill-down. Surfaced by the Throughput tile and the volume
   * Errors chart, which are the status-grouped ones. */
  onFocusSeries?: (filters: SeriesGroupFilter[]) => void;
}) {
  const [errorsMode, setErrorsMode] = useState<ErrorsMode>('rate');

  // Aggregate the raw Duration column (MV-friendly). DBTimeChart's own
  // number-format inference applies the duration unit at display, since every
  // duration series aggregates the source's duration expression (see
  // durationConfig), so no explicit format is computed here.
  const durationExpression = source.durationExpression ?? '';

  const base = useMemo(
    () => redBaseConfig(histogramTimeChartConfig),
    [histogramTimeChartConfig],
  );
  const errors = useMemo(
    () => errorsConfig(base, source.statusCodeExpression, errorsMode),
    [base, source.statusCodeExpression, errorsMode],
  );
  const duration = useMemo(
    () => durationConfig(base, durationExpression),
    [base, durationExpression],
  );

  const errorsModeControl = (
    <SegmentedControl
      key="errors-mode"
      size="xs"
      value={errorsMode}
      onChange={v => setErrorsMode(v === 'volume' ? 'volume' : 'rate')}
      data={[
        { label: 'Rate', value: 'rate' },
        { label: 'Vol', value: 'volume' },
      ]}
    />
  );

  const commonProps = {
    sourceId: source.id,
    enabled: isReady,
    showDisplaySwitcher: false,
    showMVOptimizationIndicator: false,
    showDateRangeIndicator: false,
    queryKeyPrefix,
    onTimeRangeSelect,
    enableParallelQueries: true,
    // narrow tiles: keep the edge time labels from clipping
    compactXAxisLabels: true,
  } as const;

  return (
    <IsolatedChartSyncProvider>
      <Flex direction="row" h="100%" gap="sm" mih="0" miw="0">
        <ChartCard style={RED_TILE_STYLE}>
          {/* Throughput is the status-grouped count histogram this view
              replaces, rendered from the same config under the results header's
              query-key prefix so react-query runs a single shared scan, and it
              keeps the per-status drill-down via onFocusSeries. */}
          <DBTimeChart
            title="Throughput"
            config={histogramTimeChartConfig}
            showLegend
            onFocusSeries={onFocusSeries}
            {...commonProps}
            queryKeyPrefix={throughputQueryKeyPrefix}
          />
        </ChartCard>
        {errors != null && (
          <ChartCard style={RED_TILE_STYLE}>
            {/* Remount on mode change: DBTimeChart seeds its display type
                  from the initial config when uncontrolled, so a key swap
                  re-seeds bars (volume) vs line (rate). */}
            <DBTimeChart
              key={errorsMode}
              title="Errors"
              toolbarSuffix={[errorsModeControl]}
              config={errors}
              showLegend
              hiddenSeries={
                errorsMode === 'rate' ? ERROR_RATE_HELPER_SERIES : undefined
              }
              // Rate is 0-100%: cap the axis so a flat/near-zero series
              // can't render a nonsense 0-400% scale, while still
              // auto-scaling to small values.
              yAxisMaxDomain={errorsMode === 'rate' ? 1 : undefined}
              // Volume is grouped by status, so clicking the bar filters the
              // results to that status (the histogram's drill-down). Rate is
              // a single ungrouped line, so it has nothing to drill into.
              onFocusSeries={
                errorsMode === 'volume' ? onFocusSeries : undefined
              }
              {...commonProps}
            />
          </ChartCard>
        )}
        <ChartCard style={RED_TILE_STYLE}>
          {/* Duration series pin their colors via each select item's `color`
              (set in durationConfig), so no seriesColors prop is needed here. */}
          <DBTimeChart
            title="Duration"
            config={duration}
            showLegend
            {...commonProps}
          />
        </ChartCard>
      </Flex>
    </IsolatedChartSyncProvider>
  );
}
