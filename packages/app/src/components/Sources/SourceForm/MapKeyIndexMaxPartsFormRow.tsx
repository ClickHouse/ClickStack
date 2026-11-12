import { Control, Controller } from 'react-hook-form';
import { DEFAULT_MAP_KEY_INDEX_MAX_PARTS } from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { NumberInput } from '@mantine/core';

import { FormRow } from './FormRow';

export function MapKeyIndexMaxPartsFormRow({
  control,
}: {
  control: Control<TSource>;
}) {
  return (
    <FormRow
      label="Map key index parts"
      helpText={`How many data parts are read from a Map key text index to discover attribute keys, picked around the median part size. Raise it if keys are missing from filters; lower it if fields load slowly. Defaults to ${DEFAULT_MAP_KEY_INDEX_MAX_PARTS}.`}
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
