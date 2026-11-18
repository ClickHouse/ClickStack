import { useMemo } from 'react';
import {
  ClickHouseQueryError,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderSourceFiltersToSql } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  getSqlFilters,
  getSqlQueryFilterSourceTables,
  renderSqlQueryFilterValuesQuery,
} from '@hyperdx/common-utils/dist/filters';
import { hasMacro } from '@hyperdx/common-utils/dist/macros';
import {
  BroadcastFilter,
  ChartVariable,
  Filter,
  SqlQueryDashboardFilter,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useQueries,
  UseQueryResult,
} from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { useMetadataQueryAttribution } from '@/queryAttribution';
import { useSources } from '@/source';
import { mapKeyBy } from '@/utils';

import { useMetadataWithSettings } from './useMetadata';

/** First element of every values query key, followed by the connection. */
export const SQL_QUERY_FILTER_VALUES_QUERY_KEY =
  'dashboard-filter-sql-query-values';

/** Seconds a filter's values query may run before ClickHouse stops it. */
const MAX_EXECUTION_SECONDS = 30;

type ValuesCall = {
  filterId: string;
  connection: string;
  sqlTemplate: string;
  sql: string;
  params: Record<string, number>;
  source?: TSource;
  /** The broadcast conditions `$__filters` expands to, when the SQL uses it. */
  broadcastFilters: Filter[];
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
  getDashboardFilters,
}: {
  filters: SqlQueryDashboardFilter[];
  dateRange: [Date, Date];
  /** The dashboard's variables and their current selections, if any */
  variables?: ChartVariable[];
  /** The dashboard filter selections that broadcast to the given source */
  getDashboardFilters?: (sourceId: string) => BroadcastFilter[];
}) {
  const { data: sources, isLoading: isLoadingSources } = useSources();
  const sourcesById = useMemo(() => mapKeyBy(sources ?? [], 'id'), [sources]);
  const metadata = useMetadataWithSettings();

  // Expanded here so react-query keys on the SQL that actually runs, which
  // changes with other filters' selections. `$__filters` is expanded in the
  // query function instead, since that needs the source's metadata.
  const { calls, templateErrors } = useMemo(() => {
    const resolved: ValuesCall[] = [];
    const errors = new Map<string, string>();
    for (const filter of filters) {
      const source = filter.source ? sourcesById.get(filter.source) : undefined;
      if (filter.source && !source) {
        // Every source looks missing until the list arrives.
        if (!isLoadingSources) {
          errors.set(filter.id, `Source ${filter.source} not found`);
        }
        continue;
      }
      // Variables can pair a source with a connection it isn't on.
      if (source && source.connection !== filter.connection) {
        errors.set(
          filter.id,
          `Source ${source.name} is not on the filter's connection`,
        );
        continue;
      }
      try {
        const rendered = renderSqlQueryFilterValuesQuery({
          sqlTemplate: filter.sqlTemplate,
          variables,
          dateRange,
          sourceTables: source
            ? getSqlQueryFilterSourceTables(source)
            : undefined,
        });
        resolved.push({
          filterId: filter.id,
          connection: filter.connection,
          sqlTemplate: filter.sqlTemplate,
          ...rendered,
          source,
          broadcastFilters:
            source && hasMacro(filter.sqlTemplate, 'filters')
              ? getSqlFilters(getDashboardFilters?.(source.id) ?? [])
              : [],
        });
      } catch (e) {
        errors.set(filter.id, e instanceof Error ? e.message : String(e));
      }
    }
    return { calls: resolved, templateErrors: errors };
  }, [
    filters,
    variables,
    dateRange,
    sourcesById,
    isLoadingSources,
    getDashboardFilters,
  ]);

  const attribution = useMetadataQueryAttribution();

  const results: UseQueryResult<string[]>[] = useQueries({
    queries: calls.map(call => ({
      queryKey: [
        SQL_QUERY_FILTER_VALUES_QUERY_KEY,
        call.connection,
        call.sql,
        call.params,
        call.source?.id,
        call.broadcastFilters,
      ],
      // Keep the last values while a new range or selection loads, rather than
      // blanking the dropdown.
      placeholderData: keepPreviousData,
      staleTime: 1000 * 60 * 5,
      retry: (failureCount: number, error: Error) =>
        !(error instanceof ClickHouseQueryError) && failureCount < 1,
      refetchOnWindowFocus: false,
      queryFn: async ({ signal }) => {
        let { sql } = call;
        if (call.source && call.broadcastFilters.length > 0) {
          const filtersSQL = await renderSourceFiltersToSql({
            source: call.source,
            filters: call.broadcastFilters,
            metadata,
          });
          sql = renderSqlQueryFilterValuesQuery({
            sqlTemplate: call.sqlTemplate,
            variables,
            dateRange,
            sourceTables: getSqlQueryFilterSourceTables(call.source),
            filtersSQL,
          }).sql;
        }
        const result = (await getClickhouseClient({ attribution })
          .query<'JSON'>({
            query: sql,
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

    // A filter waiting on its source has no call yet, but is still loading.
    const isWaitingForSources =
      isLoadingSources && filters.some(filter => filter.source);
    for (const filter of filters) {
      if (isWaitingForSources && !data.has(filter.id)) {
        data.set(filter.id, { values: [], isLoading: true });
      }
    }

    return {
      data,
      erroredFilterIds,
      filterErrorMessages,
      isLoading: isWaitingForSources || results.some(r => r.isLoading),
      isFetching: isWaitingForSources || results.some(r => r.isFetching),
      isError: erroredFilterIds.size > 0,
    };
  }, [results, calls, templateErrors, filters, isLoadingSources]);
}
