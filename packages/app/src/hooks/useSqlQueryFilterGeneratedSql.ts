import { useMemo } from 'react';
import { parameterizedQueryToSql } from '@hyperdx/common-utils/dist/clickhouse';
import { SqlQueryDashboardFilter } from '@hyperdx/common-utils/dist/types';
import { skipToken, useQuery } from '@tanstack/react-query';

import { useMetadataWithSettings } from './useMetadata';
import {
  DashboardState,
  renderValuesCall,
  resolveValuesCall,
  useSourcesById,
  valuesCallKey,
} from './useSqlQueryFilterValues';

const SQL_QUERY_FILTER_GENERATED_SQL_QUERY_KEY =
  'dashboard-filter-sql-query-generated-sql';

/** One filter to preview, and the dashboard state its SQL expands with. */
export type SqlQueryFilterPreviewOptions = DashboardState & {
  filter: SqlQueryDashboardFilter;
};

/**
 * A filter's own SQL as its values query runs it, with variables and macros
 * expanded and the time range inlined, but without the values wrapper. Runs
 * nothing on ClickHouse. No data while the template can't expand, since the
 * values query reports why.
 */
export function useSqlQueryFilterGeneratedSql({
  filter,
  dateRange,
  variables,
  getDashboardFilters,
}: SqlQueryFilterPreviewOptions) {
  const { sourcesById, isLoadingSources } = useSourcesById();
  const metadata = useMetadataWithSettings();

  const resolved = useMemo(
    () =>
      resolveValuesCall(filter, {
        sourcesById,
        isLoadingSources,
        dateRange,
        variables,
        getDashboardFilters,
      }),
    [
      filter,
      sourcesById,
      isLoadingSources,
      dateRange,
      variables,
      getDashboardFilters,
    ],
  );
  const call = resolved && 'call' in resolved ? resolved.call : undefined;

  return useQuery({
    queryKey: [
      SQL_QUERY_FILTER_GENERATED_SQL_QUERY_KEY,
      ...(call ? valuesCallKey(call) : []),
    ],
    queryFn: call
      ? async () => {
          const { expandedSql, params } = await renderValuesCall(call, {
            metadata,
            variables,
            dateRange,
          });
          return parameterizedQueryToSql({ sql: expandedSql, params });
        }
      : skipToken,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}
