import { useMemo } from 'react';
import { Controller, UseFormSetValue, useWatch } from 'react-hook-form';
import { Separator } from '@clickhouse/click-ui';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  getAdhocFilterAppliesToSourceIds,
  getAdhocFilterSourceKinds,
  isAdhocFilter,
} from '@hyperdx/common-utils/dist/filters';
import {
  AdhocFilterSourceType,
  DashboardFilter,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Alert, SegmentedControl } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { SourceMultiSelectControlled } from '@/components/SourceMultiSelect';
import { IS_PROMQL_ENABLED } from '@/config';
import { useSources } from '@/source';

import { TOOLTIP_PORTAL_TARGET } from './constants';
import { CustomInputWrapper } from './CustomInputWrapper';
import { FilterFormControl, FilterFormValues } from './filterFormState';
import { VariableNameInput } from './VariableNameInput';

const SOURCE_TYPE_OPTIONS: { value: AdhocFilterSourceType; label: string }[] = [
  { value: 'sql', label: 'ClickHouse' },
  { value: 'promql', label: 'Prometheus' },
];

interface AdhocFilterEditFormProps {
  control: FilterFormControl;
  setValue: UseFormSetValue<FilterFormValues>;
  /** Filters other than the one being edited, used to keep variable names unique. */
  otherFilters: DashboardFilter[];
}

/** Form describing an ad hoc dashboard filter */
export const AdhocFilterEditForm = ({
  control,
  setValue,
  otherFilters,
}: AdhocFilterEditFormProps) => {
  const { data: allSources } = useSources();
  const [sourceType, sourceIds, appliesToSourceIds] = useWatch({
    control,
    name: ['sourceType', 'sources', 'appliesToSourceIds'],
  });
  // Click-to-filter updates every ad hoc filter reaching the clicked tile.
  const overlappingFilters = useMemo(() => {
    const targets = getAdhocFilterAppliesToSourceIds({
      sources: sourceIds ?? [],
      appliesToSourceIds: appliesToSourceIds?.filter(id => !!id),
    });
    return otherFilters
      .filter(isAdhocFilter)
      .filter(
        other =>
          other.sourceType === sourceType &&
          getAdhocFilterAppliesToSourceIds(other).some(id =>
            targets.includes(id),
          ),
      );
  }, [otherFilters, sourceType, sourceIds, appliesToSourceIds]);
  const allowedSourceKinds = getAdhocFilterSourceKinds(sourceType);
  const tableConnections = useMemo(
    () =>
      (allSources ?? [])
        .filter(source => sourceIds?.includes(source.id))
        .map(tcFromSource),
    [allSources, sourceIds],
  );
  // Kept visible for a saved PromQL filter so its source type can be changed
  const showSourceType =
    sourceType === 'promql' ||
    (IS_PROMQL_ENABLED &&
      !!allSources?.some(s => s.kind === SourceKind.Promql));

  // The multi-selects hide sources of other kinds, which the form can still
  // hold after switching from another filter type.
  const validateSourceKinds = (ids: string[] | undefined) => {
    const hasOtherKind = ids?.some(id => {
      const source = allSources?.find(s => s.id === id);
      return source && !allowedSourceKinds.includes(source.kind);
    });
    return (
      !hasOtherKind ||
      (sourceType === 'promql'
        ? 'Select only PromQL sources'
        : 'Select only log, trace, or session sources')
    );
  };

  return (
    <>
      {showSourceType && (
        <CustomInputWrapper
          label="Source type"
          tooltipText="Keys come from the columns and map keys of SQL sources, or from the labels of PromQL sources"
        >
          <Controller
            control={control}
            name="sourceType"
            render={({ field: { value, onChange } }) => (
              <SegmentedControl
                size="xs"
                value={value}
                onChange={next => {
                  onChange(next);
                  // Sources of the previous type can't be kept
                  setValue('sources', [], { shouldDirty: true });
                  setValue('appliesToSourceIds', [], { shouldDirty: true });
                }}
                data={SOURCE_TYPE_OPTIONS}
                data-testid="adhoc-filter-source-type"
              />
            )}
          />
        </CustomInputWrapper>
      )}
      <CustomInputWrapper
        label="Data sources"
        tooltipText="The sources whose keys and values the filter offers"
      >
        <SourceMultiSelectControlled
          control={control}
          name="sources"
          data-testid="adhoc-filter-sources"
          comboboxProps={{ withinPortal: true }}
          placeholder="Select sources"
          allowedSourceKinds={allowedSourceKinds}
          rules={{
            validate: (value: string[] | undefined) =>
              !value?.length
                ? 'Select at least one source'
                : validateSourceKinds(value),
          }}
        />
      </CustomInputWrapper>
      {sourceType === 'sql' && (
        <CustomInputWrapper
          label="Keys and values filter"
          tooltipText="Optional condition used to filter the rows from which keys and values are suggested. May reference the dashboard's other variables."
        >
          <SearchWhereInput
            tableConnections={tableConnections}
            control={control}
            name="where"
            languageName="whereLanguage"
            allowMultiline={true}
            sqlPlaceholder="Filter for keys and values"
            lucenePlaceholder="Filter for keys and values"
            enableVariables
            parentRef={TOOLTIP_PORTAL_TARGET}
          />
        </CustomInputWrapper>
      )}

      <CustomInputWrapper
        label="Applies to sources"
        tooltipText={
          sourceType === 'promql'
            ? "The conditions are added as label matchers to every selector in PromQL tiles using these sources. Leave empty to use the filter's data sources."
            : "The conditions are applied to every tile using these sources. Leave empty to use the filter's data sources."
        }
      >
        <SourceMultiSelectControlled
          control={control}
          name="appliesToSourceIds"
          data-testid="applies-to-source-selector"
          comboboxProps={{ withinPortal: true }}
          placeholder="Same as data sources"
          allowedSourceKinds={allowedSourceKinds}
          rules={{ validate: validateSourceKinds }}
        />
      </CustomInputWrapper>
      {overlappingFilters.length > 0 && (
        <Alert
          variant="warning"
          icon={<IconAlertTriangle size={16} />}
          data-testid="adhoc-filter-overlap-warning"
        >
          Another ad hoc filter (
          {overlappingFilters.map(f => f.name).join(', ')}) already applies to
          these sources. Clicking a value in a tile will update all of them.
        </Alert>
      )}
      <Separator size="xs" />
      <VariableNameInput
        control={control}
        otherFilters={otherFilters}
        description="Unique name for this filter. Ad hoc filters can't be referenced as variables in tile queries."
      />
    </>
  );
};
