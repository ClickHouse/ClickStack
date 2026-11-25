import { useWatch } from 'react-hook-form';

import { CheckBoxControlled } from '@/components/InputControlled';

import { FilterFormControl } from './filterFormState';

/**
 * Opts a filter into offering "All" in its dropdown. Hidden for single-select
 * filters, which don't offer it.
 */
export const AllOptionCheckbox = ({
  control,
}: {
  control: FilterFormControl;
}) => {
  const isSingleSelect = useWatch({ control, name: 'isSingleSelect' });
  if (isSingleSelect) return null;

  return (
    <CheckBoxControlled
      control={control}
      name="allowAll"
      size="xs"
      label='Include "All" option'
      description="Selects every option at once. $variable references get every option, and $__conditionalAll expands to 1=1."
      data-testid="filter-allow-all-checkbox"
    />
  );
};
