import { useFormState, useWatch } from 'react-hook-form';
import {
  deriveVariableName,
  validateVariableName,
} from '@hyperdx/common-utils/dist/filters';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { TextInput } from '@mantine/core';

import { CustomInputWrapper } from './CustomInputWrapper';
import { FilterFormControl } from './filterFormState';

interface VariableNameInputProps {
  control: FilterFormControl;
  otherFilters: DashboardFilter[];
  /** For filters whose name isn't a referenceable variable. */
  label?: string;
  /** Replaces the tooltip, for filters whose name isn't a referenceable variable. */
  description?: string;
}

export const VariableNameInput = ({
  control,
  otherFilters,
  label = 'Variable name',
  description,
}: VariableNameInputProps) => {
  const { errors } = useFormState({ control });
  const filterName = useWatch({ control, name: 'name' });
  const derivedVariableName = deriveVariableName(filterName ?? '');

  return (
    <CustomInputWrapper
      label={label}
      tooltipText={
        description ? undefined : 'The name by which the variable is referenced'
      }
      error={errors.variableName}
    >
      <TextInput
        description={description}
        placeholder={derivedVariableName || 'variable_name'}
        data-testid="filter-variable-name-input"
        {...control.register('variableName', {
          validate: value =>
            validateVariableName({ value, otherFilters }) ?? true,
        })}
      />
    </CustomInputWrapper>
  );
};
