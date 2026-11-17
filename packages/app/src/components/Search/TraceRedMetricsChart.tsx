import { type CSSProperties, useMemo, useState } from 'react';
import { isUsingGroupBy } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  BuilderChartConfigWithDateRange,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { Flex, SegmentedControl } from '@mantine/core';

import { IsolatedChartSyncProvider } from '@/chartSync';
import { ChartCard } from '@/components/charts/ChartCard';
import DBHeatmapChart, {
  HEATMAP_DURATION_NUMBER_FORMAT,
  toHeatmapQuery,
} from '@/components/DBHeatmapChart';
import { DBTimeChart, type SeriesGroupFilter } from '@/components/DBTimeChart';
import { getDurationMsExpression } from '@/source';

import {
  durationConfig,
  ERROR_RATE_HELPER_SERIES,
  errorsConfig,
  ErrorsMode,
  redBaseConfig,
} from './traceRedMetrics';

/**
 * The trace results chart views, RED first as the default. The URL parser and
 * the view switch both read this list, so a new mode can't be added to the type
 * alone and silently parse back to RED.
 */
export const TRACE_CHART_MODES = ['red', 'heatmap'] as const;
export type TraceChartMode = (typeof TRACE_CHART_MODES)[number];

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

const HEATMAP_TILE_STYLE = {
  height: '100%',
  minHeight: 0,
} satisfies CSSProperties;

/**
 * RED metrics (Throughput, Errors, Duration) for the trace search results view,
 * replacing the single count histogram. The three charts render side by side as
 * sibling DBTimeCharts under a shared sync scope, so hovering one shows a
 * cross-chart cursor on all three at the same timestamp. The RED/Heatmap switch
 * lives in the search stats row (passed in as `mode`); the Heatmap view is the
 * same bare heatmap tile the dashboard renders.
 *
 * The per-chart aggregations are built by ./traceRedMetrics from the same base
 * config the histogram uses, so all three honor the active WHERE filter and
 * selected time range.
 */
export function TraceRedMetricsChart({
  mode,
  histogramTimeChartConfig,
  heatmapChartConfig,
  source,
  isReady,
  queryKeyPrefix,
  throughputQueryKeyPrefix,
  onTimeRangeSelect,
  onFocusSeries,
}: {
  /** RED vs heatmap; owned by the search stats row so the switch sits inline. */
  mode: TraceChartMode;
  /** The count-histogram config; RED charts spread this and swap only select. */
  histogramTimeChartConfig: BuilderChartConfigWithDateRange;
  /** Base config for the heatmap tile, mirroring the delta-mode callsite. */
  heatmapChartConfig: BuilderChartConfigWithDateRange;
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

  // The heatmap plots getDurationMsExpression (the source's duration already
  // scaled to ms by its durationPrecision), which is the value
  // HEATMAP_DURATION_NUMBER_FORMAT is paired with.
  const durationMsExpression = getDurationMsExpression(source);
  /**
   * Heatmap tile query (duration distribution over time), matching the
   * dashboard heatmap tile: no significant-fields comparison panel. It is the
   * query the delta view's heatmap builds with its default settings, but the
   * value, count and scale are fixed here rather than read from that view's
   * settings drawer, so this stays a plain duration heatmap independent of the
   * delta view's query state.
   */
  const heatmapQuery = useMemo(
    () =>
      toHeatmapQuery({
        ...heatmapChartConfig,
        select: [
          {
            valueExpression: durationMsExpression,
            countExpression: 'count()',
            heatmapScaleType: 'log',
          },
        ],
        numberFormat: HEATMAP_DURATION_NUMBER_FORMAT,
      }),
    [heatmapChartConfig, durationMsExpression],
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

  // Throughput stacks per status when the view is grouped (the source default),
  // where the legend names each status and is worth showing. With "group by
  // none" it collapses to a single count() series, so hide the legend instead
  // of surfacing the raw aggregate expression as a label.
  const throughputGrouped = isUsingGroupBy(histogramTimeChartConfig);

  if (mode === 'heatmap') {
    return (
      <ChartCard style={HEATMAP_TILE_STYLE}>
        <DBHeatmapChart
          title="Duration"
          query={heatmapQuery}
          enabled={isReady}
          showLegend
        />
      </ChartCard>
    );
  }

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
            showLegend={throughputGrouped}
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
          {/* The duration series pin their colors on their select items (set
              in durationConfig); applySelectColors opts this chart into them. */}
          <DBTimeChart
            title="Duration"
            config={duration}
            showLegend
            applySelectColors
            {...commonProps}
          />
        </ChartCard>
      </Flex>
    </IsolatedChartSyncProvider>
  );
}
