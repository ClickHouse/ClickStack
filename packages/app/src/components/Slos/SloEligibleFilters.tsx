import { useCallback, useMemo } from 'react';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import {
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import { describeFilter, parseQuery } from '@hyperdx/common-utils/dist/filters';
import type {
  BuilderChartConfigWithDateRange,
  Filter,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { CloseButton, Code, Group, Text } from '@mantine/core';

import { ActiveFilterPills } from '@/components/ActiveFilterPills';
import { NOW } from '@/config';
import { useColumns } from '@/hooks/useMetadata';
import { useSearchPageFilterState } from '@/searchFilters';

import type { SloFormValues } from './sloForm';

const VALUE_PICKER_RANGE_MS = 60 * 60 * 1000;
// Stable, so a missing list does not hand the filter state a new array on
// every render.
const NO_FILTERS: Filter[] = [];

/** Filters the facet pills cannot show, such as raw SQL, kept as written. */
function isRawSloFilter(filter: Filter): boolean {
  try {
    return Object.keys(parseQuery([filter]).filters).length === 0;
  } catch {
    return true;
  }
}

/**
 * The eligible-event filters, shown and edited with Search's own pills, so
 * filters carried over from Search stay visible in the SLO definition.
 */
export function SloEligibleFilters({
  control,
  setValue,
  source,
}: {
  control: Control<SloFormValues>;
  setValue: UseFormSetValue<SloFormValues>;
  source?: TSource;
}) {
  const filters =
    useWatch({ control, name: 'indicator.eligible.filters' }) ?? NO_FILTERS;
  const { data: columns } = useColumns(
    {
      databaseName: source?.from.databaseName ?? '',
      tableName: source?.from.tableName ?? '',
      connectionId: source?.connection ?? '',
    },
    { enabled: !!source },
  );
  const knownColumns = useMemo(
    () => new Set((columns ?? []).map(c => c.name)),
    [columns],
  );
  const jsonColumns = useMemo(
    () =>
      new Set(
        (filterColumnMetaByType(columns ?? [], [JSDataType.JSON]) ?? []).map(
          c => c.name,
        ),
      ),
    [columns],
  );
  const onFilterChange = useCallback(
    (next: Filter[]) =>
      setValue('indicator.eligible.filters', next, { shouldDirty: true }),
    [setValue],
  );
  const searchFilters = useSearchPageFilterState({
    searchQuery: filters,
    onFilterChange,
    knownColumns,
    jsonColumns,
    isPreservedFilter: isRawSloFilter,
  });

  // Only used by the pill value picker to list a field's recent values.
  const chartConfig = useMemo<BuilderChartConfigWithDateRange | undefined>(
    () =>
      source
        ? {
            ...buildSearchChartConfig(source, {
              where: '',
              whereLanguage: 'sql',
            }),
            dateRange: [new Date(NOW - VALUE_PICKER_RANGE_MS), new Date(NOW)],
          }
        : undefined,
    [source],
  );

  const rawFilters = filters.filter(isRawSloFilter);
  if (filters.length === 0) return null;

  return (
    <div data-testid="slo-eligible-filters">
      {chartConfig && (
        <ActiveFilterPills
          searchFilters={searchFilters}
          chartConfig={chartConfig}
          mt={6}
        />
      )}
      {rawFilters.length > 0 && (
        <Group gap={6} mt={6}>
          {rawFilters.map(filter => (
            <Group key={describeFilter(filter)} gap={2} wrap="nowrap">
              <Code>{describeFilter(filter)}</Code>
              <CloseButton
                size="xs"
                aria-label="Remove filter"
                onClick={() =>
                  onFilterChange(filters.filter(f => f !== filter))
                }
              />
            </Group>
          ))}
        </Group>
      )}
      <Text size="xs" c="dimmed" mt={4}>
        Filters narrow the eligible events together with the where clause.
      </Text>
    </div>
  );
}
