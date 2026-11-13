import { Controller, useFormState, useWatch } from 'react-hook-form';
import { DashboardFilter, SourceKind } from '@hyperdx/common-utils/dist/types';
import { Alert, Group, MultiSelect } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

import { getInterchangeableSourceKind } from '@/components/ChartEditor/utils';
import { ConnectionSelectControlled } from '@/components/ConnectionSelect';
import { SOURCE_KIND_LABELS } from '@/components/Sources/SourceForm/constants';
import { SOURCE_KIND_ICONS } from '@/components/sourceSelectUtils';
import { IS_PROMQL_ENABLED } from '@/config';

import { CustomInputWrapper } from './CustomInputWrapper';
import { FilterFormControl } from './filterFormState';
import { VariableNameInput } from './VariableNameInput';

const SOURCE_KIND_OPTIONS = Object.values(SourceKind)
  .filter(kind => IS_PROMQL_ENABLED || kind !== SourceKind.Promql)
  .map(kind => ({ value: kind, label: SOURCE_KIND_LABELS[kind] }));

interface DataSourceFilterEditFormProps {
  control: FilterFormControl;
  /** Filters other than the one being edited, used to keep variable names unique. */
  otherFilters: DashboardFilter[];
}

/** Form for editing a variable whose value is a source. */
export const DataSourceFilterEditForm = ({
  control,
  otherFilters,
}: DataSourceFilterEditFormProps) => {
  const { errors } = useFormState({ control });
  const allowedSourceKinds = useWatch({ control, name: 'allowedSourceKinds' });
  const hasMixedKinds =
    (allowedSourceKinds?.length ?? 0) > 1 &&
    getInterchangeableSourceKind(allowedSourceKinds) == null;

  return (
    <>
      <CustomInputWrapper
        label="Source kinds"
        tooltipText="The kinds of sources offered in the dropdown."
        error={errors.allowedSourceKinds}
      >
        <Controller
          control={control}
          name="allowedSourceKinds"
          rules={{
            validate: value =>
              (value?.length ?? 0) > 0 || 'Select at least one source kind',
          }}
          render={({ field: { onChange, value } }) => (
            <MultiSelect
              value={value ?? []}
              onChange={onChange}
              data={SOURCE_KIND_OPTIONS}
              placeholder="Select source kinds"
              data-testid="filter-allowed-source-kinds-input"
              comboboxProps={{ withinPortal: true }}
              renderOption={({ option }) => (
                <Group gap="xs" wrap="nowrap">
                  {SOURCE_KIND_ICONS[option.value]}
                  {option.label}
                </Group>
              )}
            />
          )}
        />
      </CustomInputWrapper>

      <CustomInputWrapper
        label="Connection"
        tooltipText="Limits the offered sources to one connection, which can be a connection variable."
      >
        <ConnectionSelectControlled
          control={control}
          name="connection"
          allowConnectionVariables
          clearable
          placeholder="Any connection"
          data-testid="filter-data-source-connection-input"
        />
      </CustomInputWrapper>

      {hasMixedKinds && (
        <Alert
          variant="warning"
          icon={<IconAlertTriangle size={16} />}
          data-testid="filter-mixed-source-kinds-warning"
        >
          These kinds support different chart options, such as metrics and
          formulas. A tile built while one kind is selected may not load when
          the variable is switched to another, and a new tile can&apos;t be
          saved until a source is selected.
        </Alert>
      )}

      <VariableNameInput control={control} otherFilters={otherFilters} />
    </>
  );
};
