import React from 'react';
import {
  ChartVariable,
  SqlQueryDashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import {
  toFilterValues,
  useSqlQueryFilterValues,
} from '@/hooks/useSqlQueryFilterValues';

const mockQuery = jest.fn();

jest.mock('@/clickhouse', () => ({
  getClickhouseClient: () => ({ query: mockQuery }),
}));

const respondWith = (rows: { value: string | null }[]) =>
  mockQuery.mockResolvedValue({ json: async () => ({ data: rows }) });

const filter = (
  overrides: Partial<SqlQueryDashboardFilter> = {},
): SqlQueryDashboardFilter => ({
  id: 'sql1',
  type: 'SQL_QUERY',
  name: 'Environment',
  connection: 'conn1',
  sqlTemplate: 'SELECT env FROM envs WHERE $__timeFilter(ts)',
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  variableName: 'env',
  ...overrides,
});

const cloud = (values: string[]): ChartVariable => ({
  name: 'cloud',
  expression: 'cloud',
  values,
});

const DATE_RANGE: [Date, Date] = [new Date(1000), new Date(2000)];

describe('useSqlQueryFilterValues', () => {
  let wrapper: React.ComponentType<{ children: React.ReactNode }>;

  const renderFilters = (
    filters: SqlQueryDashboardFilter[],
    variables?: ChartVariable[],
  ) =>
    renderHook(
      () =>
        useSqlQueryFilterValues({
          filters,
          dateRange: DATE_RANGE,
          variables,
        }),
      { wrapper },
    );

  beforeEach(() => {
    mockQuery.mockReset();
    respondWith([{ value: 'prod' }, { value: 'dev' }]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });

  it("runs the wrapped query on the filter's connection", async () => {
    const { result } = renderFilters([filter()], []);

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.data.get('sql1')).toEqual({
      values: ['prod', 'dev'],
      isLoading: false,
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [args] = mockQuery.mock.calls[0];
    expect(args.connectionId).toBe('conn1');
    expect(args.query).toMatch(/^SELECT toString\(tupleElement\(tuple\(\*\)/);
    expect(args.query).toContain('{startDateMilliseconds:Int64}');
    expect(args.query_params).toEqual({
      startDateMilliseconds: 1000,
      endDateMilliseconds: 2000,
    });
    expect(args.clickhouse_settings.max_execution_time).toBeGreaterThan(0);
  });

  it('does not re-run a query that ignores the time range when it changes', async () => {
    const filters = [filter({ sqlTemplate: 'SELECT env FROM envs' })];
    const { result, rerender } = renderHook(
      ({ dateRange }: { dateRange: [Date, Date] }) =>
        useSqlQueryFilterValues({ filters, dateRange, variables: [] }),
      { wrapper, initialProps: { dateRange: DATE_RANGE } },
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    rerender({ dateRange: [new Date(5000), new Date(6000)] });
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0].query_params).toEqual({});
  });

  it("expands other filters' selections into the query", async () => {
    const { result } = renderFilters(
      [
        filter({
          sqlTemplate: 'SELECT env FROM envs WHERE $__filter(c, $cloud)',
        }),
      ],
      [cloud(['aws'])],
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockQuery.mock.calls[0][0].query).toContain("c IN ('aws')");
  });

  it('reports a template that cannot expand without running it', async () => {
    const { result } = renderFilters(
      [filter({ sqlTemplate: 'SELECT env FROM $__sourceTable' })],
      [],
    );

    expect(result.current.erroredFilterIds).toEqual(new Set(['sql1']));
    expect(result.current.filterErrorMessages.get('sql1')).toMatch(
      /have no source/,
    );
    expect(result.current.data.get('sql1')).toEqual({
      values: [],
      isLoading: false,
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('reports a failed query with its error message', async () => {
    mockQuery.mockRejectedValue(new Error('Unknown table default.envs'));

    const { result } = renderFilters([filter()], []);

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.filterErrorMessages.get('sql1')).toBe(
      'Unknown table default.envs',
    );
  });
});

describe('toFilterValues', () => {
  it('drops nulls, empty strings, and repeats, keeping query order', () => {
    expect(
      toFilterValues([
        { value: 'b' },
        { value: null },
        { value: 'a' },
        { value: '' },
        { value: 'b' },
      ]),
    ).toEqual(['b', 'a']);
  });
});
