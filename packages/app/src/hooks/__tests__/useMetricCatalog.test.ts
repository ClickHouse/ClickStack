import React from 'react';
import {
  MetricsDataType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import {
  clampCatalogDateRange,
  useMetricCatalog,
} from '@/hooks/useMetricCatalog';

const query = jest.fn();

jest.mock('@/clickhouse', () => ({
  getClickhouseClient: () => ({ query }),
}));
jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => ({
    getColumns: () => Promise.resolve([{ name: 'MetricName' }]),
  }),
}));
jest.mock('@/queryAttribution', () => ({
  useMetadataQueryAttribution: () => ({}),
}));

const NOW = new Date('2026-08-22T12:00:00Z');
const at = (iso: string) => new Date(iso);

describe('clampCatalogDateRange', () => {
  it('defaults to the last day when no range is given', () => {
    expect(clampCatalogDateRange(undefined, NOW)).toEqual([
      at('2026-08-21T12:00:00Z'),
      NOW,
    ]);
  });

  it('widens a sub-day range forward to a full day', () => {
    // An hour of data is not enough to tell what a source reports, and the
    // metric tables are partitioned by day, so widening costs nothing extra.
    expect(
      clampCatalogDateRange(
        [at('2026-08-20T09:00:00Z'), at('2026-08-20T10:00:00Z')],
        NOW,
      ),
    ).toEqual([at('2026-08-20T09:00:00Z'), at('2026-08-21T09:00:00Z')]);
  });

  it('widens backward instead when a full day forward would pass now', () => {
    expect(
      clampCatalogDateRange([at('2026-08-22T09:00:00Z'), NOW], NOW),
    ).toEqual([at('2026-08-21T12:00:00Z'), NOW]);
  });

  it('keeps a range that is already between one and three days', () => {
    const range: [Date, Date] = [
      at('2026-08-20T00:00:00Z'),
      at('2026-08-22T00:00:00Z'),
    ];
    expect(clampCatalogDateRange(range, NOW)).toEqual(range);
  });

  it('clamps a long range to the most recent three days', () => {
    // Otherwise the catalog query would scan every partition the source has.
    expect(
      clampCatalogDateRange(
        [at('2026-01-01T00:00:00Z'), at('2026-08-22T00:00:00Z')],
        NOW,
      ),
    ).toEqual([at('2026-08-19T00:00:00Z'), at('2026-08-22T00:00:00Z')]);
  });

  it('never widens past the requested end', () => {
    const [, end] = clampCatalogDateRange(
      [at('2026-08-01T00:00:00Z'), at('2026-08-10T00:00:00Z')],
      NOW,
    );
    expect(end).toEqual(at('2026-08-10T00:00:00Z'));
  });
});

describe('useMetricCatalog', () => {
  const source: TMetricSource = {
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

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      {
        client: new QueryClient({
          defaultOptions: { queries: { retry: false } },
        }),
      },
      children,
    );

  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ json: () => Promise.resolve({ data: [] }) });
  });

  it('applies source query settings without overriding the timeout bound', async () => {
    renderHook(() => useMetricCatalog({ source }), { wrapper });

    await waitFor(() => expect(query).toHaveBeenCalled());
    expect(query.mock.calls[0][0].clickhouse_settings).toMatchObject({
      force_optimize_skip_unused_shards: '0',
      timeout_overflow_mode: 'break',
    });
  });
});
