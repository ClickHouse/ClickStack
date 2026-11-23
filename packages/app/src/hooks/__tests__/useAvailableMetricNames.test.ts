import {
  MetricsDataType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';
import { fromPartial } from '@total-typescript/shoehorn';

import { useAvailableMetricNames } from '@/hooks/useAvailableMetricNames';
import { useGetKeyValues } from '@/hooks/useMetadata';

jest.mock('@/hooks/useMetadata');

const mockUseGetKeyValues = jest.mocked(useGetKeyValues);

const METRIC_SOURCE = fromPartial<TMetricSource>({
  id: 'metric-source-1',
  kind: SourceKind.Metric,
  name: 'Metrics',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: { [MetricsDataType.Gauge]: 'otel_metrics_gauge' },
});

const DATE_RANGE: [Date, Date] = [
  new Date('2024-01-01T00:00:00Z'),
  new Date('2024-01-03T00:00:00Z'),
];

const METRIC_NAMES = ['hw.gpu.utilization', 'hw.gpu.memory.utilization'];

function render() {
  return renderHook(() =>
    useAvailableMetricNames({
      metricSource: METRIC_SOURCE,
      correlationWhere: 'ResourceAttributes.k8s.node.name:"node-1"',
      metricNames: METRIC_NAMES,
      dateRange: DATE_RANGE,
    }),
  );
}

describe('useAvailableMetricNames', () => {
  afterEach(() => jest.resetAllMocks());

  it('reports the metric names the query returned', () => {
    mockUseGetKeyValues.mockReturnValue(
      fromPartial({
        data: [{ key: 'MetricName', value: METRIC_NAMES }],
        isLoading: false,
        isPlaceholderData: false,
      }),
    );
    const { result } = render();
    expect([...result.current.availableMetrics].sort()).toEqual(
      [...METRIC_NAMES].sort(),
    );
    expect(result.current.isLoading).toBe(false);
  });

  it('reports loading while the first query is in flight', () => {
    mockUseGetKeyValues.mockReturnValue(
      fromPartial({
        data: undefined,
        isLoading: true,
        isPlaceholderData: false,
      }),
    );
    expect(render().result.current.isLoading).toBe(true);
  });

  // useGetKeyValues sets `placeholderData: keepPreviousData`, so switching to a
  // different correlated resource keeps the previous one's answer readable with
  // `isLoading` false. Reporting that as settled would leak one host's chart
  // set onto the next.
  it('reports loading while showing another resource placeholder data', () => {
    mockUseGetKeyValues.mockReturnValue(
      fromPartial({
        data: [{ key: 'MetricName', value: METRIC_NAMES }],
        isLoading: false,
        isPlaceholderData: true,
      }),
    );
    const { result } = render();
    expect(result.current.isLoading).toBe(true);
  });

  it('returns an empty set when the query has no data', () => {
    mockUseGetKeyValues.mockReturnValue(
      fromPartial({
        data: undefined,
        isLoading: false,
        isPlaceholderData: false,
      }),
    );
    expect(render().result.current.availableMetrics.size).toBe(0);
  });
});
