import {
  BuilderChartConfig,
  BuilderSavedChartConfig,
  ChartConfig,
  ChartConfigWithOptDateRange,
  DisplayType,
  HeatmapMode,
  NON_PROMQL_SOURCE_KINDS,
  PromqlChartConfig,
  PromqlHeatmapMode,
  PromqlSavedChartConfig,
  RawSqlChartConfig,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  SourceKind,
  TSource,
} from './types';

/** Source kinds that can back a distribution-mode heatmap tile. */
export const HEATMAP_DISTRIBUTION_SOURCE_KINDS: ReadonlyArray<SourceKind> = [
  SourceKind.Trace,
];

/** Source kinds that can back a series-mode heatmap tile. */
export const HEATMAP_SERIES_SOURCE_KINDS: ReadonlyArray<SourceKind> = [
  SourceKind.Trace,
  SourceKind.Log,
  SourceKind.Metric,
];

export function getHeatmapSourceKinds(
  mode: HeatmapMode = 'distribution',
): ReadonlyArray<SourceKind> {
  return mode === 'series'
    ? HEATMAP_SERIES_SOURCE_KINDS
    : HEATMAP_DISTRIBUTION_SOURCE_KINDS;
}

/**
 * Whether a source can back a heatmap tile in the given mode.
 */
export function isHeatmapCompatibleSource(
  source: Pick<TSource, 'kind'>,
  mode: HeatmapMode = 'distribution',
): boolean {
  return getHeatmapSourceKinds(mode).includes(source.kind);
}

export function isRawSqlChartConfig(
  chartConfig: ChartConfig | ChartConfigWithOptDateRange,
): chartConfig is RawSqlChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'sql';
}

export function isPromqlChartConfig(
  chartConfig: ChartConfig | ChartConfigWithOptDateRange,
): chartConfig is PromqlChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'promql';
}

export function isBuilderChartConfig(
  chartConfig: ChartConfig | ChartConfigWithOptDateRange,
): chartConfig is BuilderChartConfig {
  return !isRawSqlChartConfig(chartConfig) && !isPromqlChartConfig(chartConfig);
}

export function isRawSqlSavedChartConfig(
  chartConfig: SavedChartConfig,
): chartConfig is RawSqlSavedChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'sql';
}

export function isPromqlSavedChartConfig(
  chartConfig: SavedChartConfig,
): chartConfig is PromqlSavedChartConfig {
  return 'configType' in chartConfig && chartConfig.configType === 'promql';
}

export function isBuilderSavedChartConfig(
  chartConfig: SavedChartConfig,
): chartConfig is BuilderSavedChartConfig {
  return (
    !isRawSqlSavedChartConfig(chartConfig) &&
    !isPromqlSavedChartConfig(chartConfig)
  );
}

/**
 * Returns true when a display type semantically requires a data source to be
 * configured. Currently Markdown is the only display type that does not need a
 * source (it renders static content). Add any future sourceless display types
 * here rather than scattering per-type checks across the codebase.
 */
export function displayTypeRequiresSource(
  displayType: DisplayType | undefined,
): boolean {
  return displayType !== DisplayType.Markdown;
}

/**
 * Display types that store `select` as a plain string (column expression)
 * rather than a structured `DerivedColumn[]` series array. These types
 * don't use the builder series editor and skip series-level validation.
 */
export const isStringSelectDisplayType = (
  displayType: DisplayType | undefined,
): displayType is DisplayType.Search | DisplayType.EventPatterns =>
  displayType === DisplayType.Search ||
  displayType === DisplayType.EventPatterns;

export const isPromqlDisplayType = (
  displayType: DisplayType | undefined,
): displayType is
  | DisplayType.Table
  | DisplayType.Line
  | DisplayType.StackedBar
  | DisplayType.StackedLine
  | DisplayType.Pie
  | DisplayType.Bar
  | DisplayType.Number
  | DisplayType.Heatmap =>
  displayType === DisplayType.Table ||
  displayType === DisplayType.Line ||
  displayType === DisplayType.StackedBar ||
  displayType === DisplayType.StackedLine ||
  displayType === DisplayType.Pie ||
  displayType === DisplayType.Bar ||
  displayType === DisplayType.Number ||
  displayType === DisplayType.Heatmap;

/** A heatmap mode as a builder heatmap's, which has no histogram mode. */
export function toBuilderHeatmapMode(
  mode: PromqlHeatmapMode | undefined,
): HeatmapMode | undefined {
  return mode === 'histogram' ? undefined : mode;
}

/**
 * Search and event patterns list raw rows out of the source's `from` table. A
 * metric source keeps its rows in `metricTables` and leaves `from.tableName`
 * empty, so there is nothing for them to read.
 */
const ROW_LISTING_SOURCE_KINDS = NON_PROMQL_SOURCE_KINDS.filter(
  kind => kind !== SourceKind.Metric,
);

/** Source kinds a chart can use, given its config type and display type. */
export function getAllowedSourceKinds({
  configType,
  displayType,
  heatmapMode,
}: {
  configType: 'builder' | 'sql' | 'promql' | undefined;
  displayType: DisplayType | undefined;
  heatmapMode?: PromqlHeatmapMode;
}): SourceKind[] {
  if (configType === 'promql' && isPromqlDisplayType(displayType)) {
    return [SourceKind.Promql];
  }
  if (displayType === DisplayType.Heatmap) {
    return [...getHeatmapSourceKinds(toBuilderHeatmapMode(heatmapMode))];
  }
  if (isStringSelectDisplayType(displayType)) {
    return ROW_LISTING_SOURCE_KINDS;
  }
  return [...NON_PROMQL_SOURCE_KINDS];
}

/** `getAllowedSourceKinds` for a saved chart config. */
export function getSavedConfigAllowedSourceKinds(
  config: SavedChartConfig,
): SourceKind[] {
  if (isRawSqlSavedChartConfig(config)) {
    return getAllowedSourceKinds({
      configType: 'sql',
      displayType: config.displayType,
    });
  }
  return getAllowedSourceKinds({
    configType: isPromqlSavedChartConfig(config) ? 'promql' : 'builder',
    displayType: config.displayType,
    heatmapMode: config.heatmap?.mode,
  });
}
