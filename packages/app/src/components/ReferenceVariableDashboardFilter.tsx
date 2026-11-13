import { useCallback, useMemo } from 'react';
import {
  ConnectionDashboardFilter as ConnectionFilter,
  DataSourceDashboardFilter as DataSourceFilter,
} from '@hyperdx/common-utils/dist/types';
import { ComboboxItem, Group, Select, Stack } from '@mantine/core';
import { IconServer, IconStack } from '@tabler/icons-react';

import {
  getSourceOptionIcon,
  sourceSelectFilter,
  SourceSelectGroup,
  useFilteredSortedSourceItems,
  useSourceKindMap,
} from '@/components/sourceSelectUtils';
import { useConnectionItems } from '@/hooks/useConnectionItems';
import { useSources } from '@/source';

import {
  DashboardFilterLabel,
  FilterCaution,
  FilterEffect,
  getPendingVariablesTooltip,
} from './DashboardFilterLabel';

type ReferenceVariableFilterProps = {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  effect: FilterEffect;
  requiredTooltip: string;
};

/**
 * The filter bar control shared by data source and connection variables: a
 * single picker over the IDs the variable can select.
 */
function ReferenceVariableSelect({
  name,
  items,
  value,
  onChange,
  effect,
  requiredTooltip,
  pendingVariables,
  placeholder,
  renderIcon,
}: ReferenceVariableFilterProps & {
  name: string;
  items: ComboboxItem[] | SourceSelectGroup[];
  pendingVariables?: string[];
  placeholder: string;
  renderIcon: (value: string | null) => React.ReactNode;
}) {
  // A selection that is no longer offered (deleted, disabled, or no longer
  // allowed by the variable) shows as empty, so it reads as unselected.
  const isOffered = useMemo(
    () =>
      items.some(item =>
        'group' in item
          ? item.items.some(i => i.value === value)
          : item.value === value,
      ),
    [items, value],
  );
  const selected = value && isOffered ? value : null;

  const renderOption = useCallback(
    ({ option }: { option: ComboboxItem }) => (
      <Group gap="xs" wrap="nowrap">
        {renderIcon(option.value)}
        {option.label}
      </Group>
    ),
    [renderIcon],
  );

  return (
    <Stack gap={2}>
      <DashboardFilterLabel name={name} effect={effect}>
        {selected == null && (
          <FilterCaution
            label={requiredTooltip}
            testId={`dashboard-filter-required-${name}`}
          />
        )}
        {!!pendingVariables?.length && (
          <FilterCaution
            label={getPendingVariablesTooltip(pendingVariables)}
            testId={`dashboard-filter-pending-variable-${name}`}
          />
        )}
      </DashboardFilterLabel>
      <Select
        w={250}
        size="xs"
        placeholder={placeholder}
        data={items}
        value={selected}
        onChange={id => onChange(id ?? undefined)}
        renderOption={renderOption}
        filter={sourceSelectFilter}
        leftSection={renderIcon(selected)}
        searchable
        allowDeselect={false}
        data-testid={`dashboard-filter-select-${name}`}
      />
    </Stack>
  );
}

/**
 * A data source variable's picker. `filter` carries its connection resolved;
 * while that connection's variable is unselected no source is offered.
 */
export const DataSourceDashboardFilter = ({
  filter,
  pendingVariables,
  ...props
}: ReferenceVariableFilterProps & {
  filter: DataSourceFilter;
  pendingVariables?: string[];
}) => {
  const { data: sources } = useSources();
  const sourceKindMap = useSourceKindMap(sources);
  const items = useFilteredSortedSourceItems({
    sources,
    allowedSourceKinds: filter.allowedSourceKinds,
    connectionId: filter.connection,
    groupBySection: true,
  });
  const renderIcon = useCallback(
    (value: string | null) =>
      getSourceOptionIcon(value ?? undefined, sourceKindMap) ?? (
        <IconStack size={16} />
      ),
    [sourceKindMap],
  );

  return (
    <ReferenceVariableSelect
      {...props}
      name={filter.name}
      items={items}
      pendingVariables={pendingVariables}
      placeholder="Select a source"
      renderIcon={renderIcon}
    />
  );
};

const renderConnectionIcon = () => <IconServer size={16} />;

/** A connection variable's picker. */
export const ConnectionDashboardFilter = ({
  filter,
  ...props
}: ReferenceVariableFilterProps & { filter: ConnectionFilter }) => {
  const items = useConnectionItems({ sorted: true });

  return (
    <ReferenceVariableSelect
      {...props}
      name={filter.name}
      items={items}
      placeholder="Select a connection"
      renderIcon={renderConnectionIcon}
    />
  );
};
