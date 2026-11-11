import {
  Control,
  Controller,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import {
  AlertThresholdType,
  isRangeThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { NativeSelect, NumberInput, Text } from '@mantine/core';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { optionsToSelectData } from '@/utils';
import { TILE_ALERT_THRESHOLD_TYPE_OPTIONS } from '@/utils/alerts';

/** The comparison, threshold and (for ranges) upper bound of a tile alert. */
export function ThresholdConditionFields({
  control,
  setValue,
}: {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
}) {
  const alertThresholdType = useWatch({ control, name: 'alert.thresholdType' });
  const alertThreshold = useWatch({ control, name: 'alert.threshold' });
  const alertThresholdMax = useWatch({ control, name: 'alert.thresholdMax' });

  return (
    <>
      <Controller
        control={control}
        name="alert.thresholdType"
        render={({ field }) => (
          <NativeSelect
            data={optionsToSelectData(TILE_ALERT_THRESHOLD_TYPE_OPTIONS)}
            size="xs"
            {...field}
            onChange={e => {
              field.onChange(e);
              if (
                isRangeThresholdType(e.currentTarget.value) &&
                alertThresholdMax == null
              ) {
                setValue('alert.thresholdMax', (alertThreshold ?? 0) + 1);
              }
            }}
          />
        )}
      />
      <Controller
        control={control}
        name="alert.threshold"
        render={({ field }) => <NumberInput size="xs" w={80} {...field} />}
      />
      {isRangeThresholdType(alertThresholdType as AlertThresholdType) && (
        <>
          <Text size="sm" opacity={0.7}>
            and
          </Text>
          <Controller
            control={control}
            name="alert.thresholdMax"
            render={({ field, fieldState }) => (
              <NumberInput
                size="xs"
                w={80}
                {...field}
                error={fieldState.error?.message}
              />
            )}
          />
        </>
      )}
    </>
  );
}
