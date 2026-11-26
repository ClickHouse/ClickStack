import React from 'react';
import {
  BroadcastFilter,
  SourceKind,
  SqlQueryDashboardFilter,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useSqlQueryFilterGeneratedSql } from '@/hooks/useSqlQueryFilterGeneratedSql';

const mockQuery = jest.fn();
const mockRenderSourceFiltersToSql = jest.fn();

jest.mock('@/clickhouse', () => ({
  getClickhouseClient: () => ({ query: mockQuery }),
}));
jest.mock('@/source', () => ({
  useSources: () => ({ data: [logs], isLoading: false }),
}));
jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => ({}),
}));
jest.mock('@hyperdx/common-utils/dist/core/renderChartConfig', () => ({
  renderSourceFiltersToSql: (...args: unknown[]) =>
    mockRenderSourceFiltersToSql(...args),
}));

const logs: TSource = {
  id: 'logs',
  name: 'Logs',
  kind: SourceKind.Log,
  connection: 'conn1',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: '',
};

const filter = (
  overrides: Partial<SqlQueryDashboardFilter> = {},
): SqlQueryDashboardFilter => ({
  id: 'sql1',
  type: 'SQL_QUERY',
  name: 'Environment',
  connection: 'conn1',
  sqlTemplate: 'SELECT env FROM envs',
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  ...overrides,
});

const DATE_RANGE: [Date, Date] = [new Date(1000), new Date(2000)];

describe('useSqlQueryFilterGeneratedSql', () => {
  let wrapper: React.ComponentType<{ children: React.ReactNode }>;

  const renderGeneratedSql = (
    sqlFilter: SqlQueryDashboardFilter,
    getDashboardFilters?: (sourceId: string) => BroadcastFilter[],
  ) =>
    renderHook(
      () =>
        useSqlQueryFilterGeneratedSql({
          filter: sqlFilter,
          dateRange: DATE_RANGE,
          variables: [{ name: 'cloud', expression: 'cloud', values: ['aws'] }],
          getDashboardFilters,
        }),
      { wrapper },
    );

  beforeEach(() => {
    mockQuery.mockReset();
    mockRenderSourceFiltersToSql.mockReset();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });

  it('fills in variables and the time range, without the values wrapper or a ClickHouse call', async () => {
    const { result } = renderGeneratedSql(
      filter({
        sqlTemplate:
          'SELECT env FROM envs WHERE $__timeFilter(ts) AND $__filter(c, $cloud);',
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(
      "SELECT env FROM envs WHERE ts >= toDateTime(fromUnixTimestamp64Milli(1000)) AND ts <= toDateTime(fromUnixTimestamp64Milli(2000)) AND (c IN ('aws'))",
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("fills in the source's table and its dashboard filters", async () => {
    mockRenderSourceFiltersToSql.mockResolvedValue("(ServiceName = 'api')");
    const selections: BroadcastFilter[] = [
      { type: 'sql', condition: "ServiceName IN ('api')" },
    ];

    const { result } = renderGeneratedSql(
      filter({
        source: 'logs',
        sqlTemplate: 'SELECT 1 FROM $__sourceTable WHERE $__filters',
      }),
      () => selections,
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(
      "SELECT 1 FROM `default`.`otel_logs` WHERE (ServiceName = 'api')",
    );
  });

  it('has no SQL for a template that cannot expand', () => {
    const { result } = renderGeneratedSql(
      filter({ sqlTemplate: 'SELECT env FROM $__sourceTable' }),
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
