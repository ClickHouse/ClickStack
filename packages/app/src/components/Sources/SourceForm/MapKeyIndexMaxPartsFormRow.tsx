import { Control, Controller } from 'react-hook-form';
import { DEFAULT_MAP_KEY_INDEX_MAX_PARTS } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { NumberInput } from '@mantine/core';

import SelectControlled from '@/components/SelectControlled';

import { MAP_KEY_INDEX_PART_SELECTION_OPTIONS } from './constants';
import { FormRow } from './FormRow';

export function MapKeyIndexMaxPartsFormRow({
  control,
}: {
  control: Control<TSource>;
}) {
  return (
    <FormRow
      label="Map key index parts"
      helpText={`How many data parts are read from text indexes to discover attribute keys and filter values; "Map key index part size" picks which ones. Raise it if keys or values are missing from filters; lower it if they load slowly. Defaults to ${DEFAULT_MAP_KEY_INDEX_MAX_PARTS}.`}
    >
      <Controller
        control={control}
        name="mapKeyIndexMaxParts"
        render={({ field, fieldState }) => (
          <NumberInput
            {...field}
            value={field.value ?? ''}
            onChange={v => field.onChange(v === '' ? undefined : v)}
            min={1}
            allowDecimal={false}
            allowNegative={false}
            placeholder={String(DEFAULT_MAP_KEY_INDEX_MAX_PARTS)}
            error={fieldState.error?.message}
          />
        )}
      />
    </FormRow>
  );
}

export function MapKeyIndexPartSelectionFormRow({
  control,
}: {
  control: Control<TSource>;
}) {
  return (
    <FormRow
      label="Map key index part size"
      helpText='Which data parts, by row count, are read from text indexes for attribute keys and filter values. "Median" balances coverage and cost; "Smallest" reads the newest unmerged parts, which is cheap and shows new keys first; "Largest" reads the most merged data, which covers the most keys but reads the biggest indexes.'
    >
      <SelectControlled
        control={control}
        name="mapKeyIndexPartSelection"
        data={MAP_KEY_INDEX_PART_SELECTION_OPTIONS}
        placeholder={MAP_KEY_INDEX_PART_SELECTION_OPTIONS[0].label}
        allowDeselect={false}
      />
    </FormRow>
  );
}
