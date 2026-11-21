import React from 'react';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import type DBHeatmapChartType from '@/components/DBHeatmapChart';
import { HEATMAP_DURATION_NUMBER_FORMAT } from '@/components/DBHeatmapChart';
import type { DBTimeChart as DBTimeChartType } from '@/components/DBTimeChart';
import { TraceRedMetricsChart } from '@/components/Search/TraceRedMetricsChart';

type HeatmapProps = React.ComponentProps<typeof DBHeatmapChartType>;
type TimeChartProps = React.ComponentProps<typeof DBTimeChartType>;
const mockHeatmapProps: HeatmapProps[] = [];
const mockTimeChartProps: TimeChartProps[] = [];

// Only the chart components are stubbed. The real query builder and number
// format stay, so the test checks the query the heatmap actually gets.
jest.mock('../../DBHeatmapChart', () => ({
  __esModule: true,
  default: jest.fn((props: HeatmapProps) => {
    mockHeatmapProps.push(props);
    return <div data-testid="db-heatmap-chart" />;
  }),
  toHeatmapQuery: jest.requireActual<
    typeof import('../../DBHeatmapChart/heatmapQueries')
  >('../../DBHeatmapChart/heatmapQueries').toHeatmapQuery,
  HEATMAP_DURATION_NUMBER_FORMAT: jest.requireActual<
    typeof import('../../DBHeatmapChart/heatmapAxis')
  >('../../DBHeatmapChart/heatmapAxis').HEATMAP_DURATION_NUMBER_FORMAT,
}));

jest.mock('../../DBTimeChart', () => ({
  DBTimeChart: jest.fn((props: TimeChartProps) => {
    mockTimeChartProps.push(props);
    return <div data-testid="db-time-chart" />;
  }),
}));

jest.mock('@/source', () => ({
  ...jest.requireActual<typeof import('@/source')>('@/source'),
  getDurationMsExpression: jest.fn(() => 'duration_ms_expr'),
}));

const source: TTraceSource = {
  id: 'trace-source',
  kind: SourceKind.Trace,
  name: 'Trace Source',
  connection: 'conn',
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp',
  durationExpression: 'Duration',
  durationPrecision: 3,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  statusCodeExpression: 'StatusCode',
};

const baseConfig: BuilderChartConfigWithDateRange = {
  dateRange: [new Date(0), new Date(60_000)],
  from: { databaseName: 'otel', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  connection: 'conn',
  select: '',
  where: '',
  whereLanguage: 'sql',
};

const histogramTimeChartConfig: BuilderChartConfigWithDateRange = {
  ...baseConfig,
  select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
  groupBy: 'StatusCode',
  granularity: 'auto',
};

function renderChart(mode: 'red' | 'heatmap') {
  renderWithMantine(
    <TraceRedMetricsChart
      mode={mode}
      histogramTimeChartConfig={histogramTimeChartConfig}
      heatmapChartConfig={baseConfig}
      source={source}
      isReady
    />,
  );
}

function asDistribution(query: HeatmapProps['query']) {
  if (query.mode !== 'distribution') {
    throw new Error(`expected a distribution query, got ${query.mode}`);
  }
  return query;
}

describe('TraceRedMetricsChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHeatmapProps.length = 0;
    mockTimeChartProps.length = 0;
  });

  it('renders the duration heatmap, not the RED tiles, in heatmap mode', () => {
    renderChart('heatmap');

    expect(screen.getByTestId('db-heatmap-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('db-time-chart')).not.toBeInTheDocument();

    const props = mockHeatmapProps[mockHeatmapProps.length - 1];
    expect(props.enabled).toBe(true);
    const query = asDistribution(props.query);
    // The source's duration in ms, counted per bucket on a log scale, with the
    // duration number format: the delta view's default duration heatmap.
    expect(query.config.select).toEqual([
      {
        aggFn: 'heatmap',
        valueExpression: 'duration_ms_expr',
        countExpression: 'count()',
      },
    ]);
    expect(query.scaleType).toBe('log');
    expect(query.config.numberFormat).toEqual(HEATMAP_DURATION_NUMBER_FORMAT);
    expect(query.config.dateRange).toBe(baseConfig.dateRange);
  });

  it('renders the three RED tiles, not the heatmap, in RED mode', () => {
    renderChart('red');

    expect(screen.queryByTestId('db-heatmap-chart')).not.toBeInTheDocument();
    expect(new Set(mockTimeChartProps.map(p => p.title))).toEqual(
      new Set(['Throughput', 'Errors', 'Duration']),
    );
    // Only the Duration tile opts into its select items' pinned colors.
    expect(
      new Set(
        mockTimeChartProps.filter(p => p.applySelectColors).map(p => p.title),
      ),
    ).toEqual(new Set(['Duration']));
  });
});
