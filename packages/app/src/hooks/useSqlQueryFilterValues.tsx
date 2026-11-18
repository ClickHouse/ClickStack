import { useMemo } from 'react';
import {
  ClickHouseQueryError,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderSqlQueryFilterValuesQuery } from '@hyperdx/common-utils/dist/filters';
import {
  ChartVariable,
  SqlQueryDashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useQueries,
  UseQueryResult,
} from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { useMetadataQueryAttribution } from '@/queryAttribution';

/** Seconds a filter's values query may run before ClickHouse stops it. */
const MAX_EXECUTION_SECONDS = 30;

type ValuesCall = {
  filterId: string;
  connection: string;
  sql: string;
  params: Record<string, number>;
};

/** Rows from the values query, without nulls or repeats, in query order. */
export const toFilterValues = (rows: { value: string | null }[]): string[] =>
  Array.from(
    new Set(
      rows.map(row => row.value).filter((value): value is string => !!value),
    ),
  );

export function useSqlQueryFilterValues({
  filters,
  dateRange,
  variables,
}: {
  filters: SqlQueryDashboardFilter[];
  dateRange: [Date, Date];
  /** The dashboard's variables and their current selections, if any */
  variables?: ChartVariable[];
}) {
  // Expanded here so react-query keys on the SQL that actually runs, which
  // changes with other filters' selections.
  const { calls, templateErrors } = useMemo(() => {
    const resolved: ValuesCall[] = [];
    const errors = new Map<string, string>();
    for (const filter of filters) {
      try {
        resolved.push({
          filterId: filter.id,
          connection: filter.connection,
          ...renderSqlQueryFilterValuesQuery({
            sqlTemplate: filter.sqlTemplate,
            variables,
            dateRange,
          }),
        });
      } catch (e) {
        errors.set(filter.id, e instanceof Error ? e.message : String(e));
      }
    }
    return { calls: resolved, templateErrors: errors };
  }, [filters, variables, dateRange]);

  const attribution = useMetadataQueryAttribution();

  const results: UseQueryResult<string[]>[] = useQueries({
    queries: calls.map(call => ({
      queryKey: [
        'dashboard-filter-sql-query-values',
        call.connection,
        call.sql,
        call.params,
      ],
      // Keep the last values while a new range or selection loads, rather than
      // blanking the dropdown.
      placeholderData: keepPreviousData,
      staleTime: 1000 * 60 * 5,
      retry: (failureCount: number, error: Error) =>
        !(error instanceof ClickHouseQueryError) && failureCount < 1,
      refetchOnWindowFocus: false,
      queryFn: async ({ signal }) => {
        const result = (await getClickhouseClient({ attribution })
          .query<'JSON'>({
            query: call.sql,
            query_params: call.params,
            format: 'JSON',
            abort_signal: signal,
            connectionId: call.connection,
            clickhouse_settings: {
              max_execution_time: MAX_EXECUTION_SECONDS,
              // On timeout, list the values read so far instead of failing.
              timeout_overflow_mode: 'break',
            },
          })
          .then(res => res.json())) as ResponseJSON<{ value: string | null }>;
        return toFilterValues(result.data ?? []);
      },
    })),
  });

  return useMemo(() => {
    const data = new Map<string, { values: string[]; isLoading: boolean }>();
    const erroredFilterIds = new Set<string>();
    const filterErrorMessages = new Map<string, string>();

    results.forEach((result, index) => {
      const call = calls[index];
      if (!call) return;
      data.set(call.filterId, {
        values: result.data ?? [],
        isLoading: result.isLoading,
      });
      if (result.isError) {
        erroredFilterIds.add(call.filterId);
        if (result.error instanceof Error) {
          filterErrorMessages.set(call.filterId, result.error.message);
        }
      }
    });

    for (const [filterId, message] of templateErrors) {
      data.set(filterId, { values: [], isLoading: false });
      erroredFilterIds.add(filterId);
      filterErrorMessages.set(filterId, message);
    }

    return {
      data,
      erroredFilterIds,
      filterErrorMessages,
      isLoading: results.some(r => r.isLoading),
      isFetching: results.some(r => r.isFetching),
      isError: erroredFilterIds.size > 0,
    };
  }, [results, calls, templateErrors]);
}
