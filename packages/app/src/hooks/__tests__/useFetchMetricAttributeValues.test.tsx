import React from 'react';
import {
  MetricsDataType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useFetchMetricAttributeValues } from '@/hooks/useFetchMetricAttributeValues';

const query = jest.fn();

jest.mock('@/clickhouse', () => ({
  getClickhouseClient: () => ({ query }),
}));
jest.mock('@/queryAttribution', () => ({
  useMetadataQueryAttribution: () => ({}),
}));

const SOURCE: TMetricSource = {
  id: 'metrics',
  name: 'Metrics',
  kind: SourceKind.Metric,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: {
    [MetricsDataType.Gauge]: 'otel_metrics_gauge',
    [MetricsDataType.Sum]: '',
    [MetricsDataType.Histogram]: '',
    [MetricsDataType.ExponentialHistogram]: '',
    [MetricsDataType.Summary]: '',
  },
  querySettings: [
    { setting: 'force_optimize_skip_unused_shards', value: '0' },
    { setting: 'timeout_overflow_mode', value: 'throw' },
  ],
};

const COMMON_ARGS = {
  databaseName: 'default',
  metricType: MetricsDataType.Gauge,
  metricName: 'up',
  tableSource: SOURCE,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

async function settingsSent() {
  await waitFor(() => expect(query).toHaveBeenCalled());
  return query.mock.calls[0][0].clickhouse_settings;
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ json: () => Promise.resolve({ data: [] }) });
});

describe('useFetchMetricAttributeValues', () => {
  it('applies source query settings without overriding its timeout bound', async () => {
    renderHook(
      () =>
        useFetchMetricAttributeValues({
          ...COMMON_ARGS,
          attributeName: 'service.name',
          attributeCategory: 'ResourceAttributes',
        }),
      { wrapper: createWrapper() },
    );

    expect(await settingsSent()).toMatchObject({
      force_optimize_skip_unused_shards: '0',
      timeout_overflow_mode: 'break',
    });
  });
});
