import { useEffect, useRef } from 'react';
import {
  type Control,
  Controller,
  type UseFormGetValues,
  type UseFormSetValue,
  useFormState,
  useWatch,
} from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  buildSloLatencyGoodSql,
  getSloDefaultDuration,
} from '@hyperdx/common-utils/dist/core/sloLatency';
import { SloDurationUnitSchema } from '@hyperdx/common-utils/dist/slo';
import type { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Checkbox,
  Group,
  Input,
  NumberInput,
  Select,
  Text,
} from '@mantine/core';

import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

import { getNativeDuration, type SloFormValues, toSloLatency } from './sloForm';
import { SloFormRow } from './SloFormLayout';

const UNIT_OPTIONS = [
  { value: 'ns', label: 'Nanoseconds' },
  { value: 'us', label: 'Microseconds' },
  { value: 'ms', label: 'Milliseconds' },
  { value: 's', label: 'Seconds' },
];

/**
 * Where the duration comes from and the threshold it is held to. Trace
 * sources start on their duration column, in the unit of the source's
 * duration precision; any source can point at another column or attribute,
 * such as a log attribute holding milliseconds, and say which unit it holds.
 */
export function SloLatencyFields({
  control,
  getValues,
  setValue,
  source,
}: {
  control: Control<SloFormValues>;
  getValues: UseFormGetValues<SloFormValues>;
  setValue: UseFormSetValue<SloFormValues>;
  source?: TSource;
}) {
  const latency = useWatch({ control, name: 'indicator.latency' });
  const { errors } = useFormState({
    control,
    name: 'indicator.latency.expression',
  });
  const expression = latency.expression.trim();
  const native = getNativeDuration(expression, source) != null;
  // A native duration is in the source's unit, whatever the form holds.
  const saved = toSloLatency({ ...latency, expression }, source);

  // Switching sources replaces the source's duration column, never an
  // expression the user typed.
  const nativeDurationRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!source) return;
    const sourceDuration = getSloDefaultDuration(source);
    const current = getValues('indicator.latency.expression').trim();
    if (current === '' || current === nativeDurationRef.current) {
      setValue(
        'indicator.latency.expression',
        sourceDuration?.expression ?? '',
      );
      if (sourceDuration) {
        setValue('indicator.latency.unit', sourceDuration.unit);
      }
    }
    nativeDurationRef.current = sourceDuration?.expression;
  }, [source, getValues, setValue]);

  return (
    <>
      <SloFormRow
        label="Duration"
        helpText="The column or expression that holds each event's duration. Trace sources start on their duration column."
      >
        <SQLInlineEditorControlled
          tableConnection={tcFromSource(source)}
          sourceId={source?.id}
          control={control}
          name="indicator.latency.expression"
          placeholder={
            source?.kind === 'log'
              ? "Column or attribute, for example LogAttributes['duration_ms']"
              : 'Column or expression'
          }
          disableKeywordAutocomplete
          size="sm"
        />
        <Input.Error mt={4}>
          {errors.indicator?.latency?.expression?.message}
        </Input.Error>
        {!native && expression !== '' && (
          <Controller
            control={control}
            name="indicator.latency.requireDuration"
            render={({ field }) => (
              <Checkbox
                mt="xs"
                label="Leave out events without a duration"
                description={
                  field.value
                    ? 'Events where the value is missing or not a number are not eligible.'
                    : 'Events where the value is missing or not a number count as bad.'
                }
                checked={field.value ?? true}
                onChange={e => field.onChange(e.currentTarget.checked)}
              />
            )}
          />
        )}
      </SloFormRow>
      <SloFormRow
        label="Duration unit"
        helpText="The unit the duration is stored in. The source's duration column uses the source's duration precision."
        inline
      >
        <Group gap="sm" wrap="nowrap">
          <Controller
            control={control}
            name="indicator.latency.unit"
            render={({ field }) => (
              <Select
                aria-label="Duration unit"
                data={UNIT_OPTIONS}
                value={saved.unit}
                onChange={value => {
                  const unit = SloDurationUnitSchema.safeParse(value);
                  if (unit.success) field.onChange(unit.data);
                }}
                allowDeselect={false}
                disabled={native}
                w={180}
                data-testid="slo-latency-unit"
              />
            )}
          />
          <Text size="xs" c="dimmed">
            {native
              ? "From the source's Duration Precision setting"
              : 'The unit the expression returns'}
          </Text>
        </Group>
      </SloFormRow>
      <SloFormRow
        label="Good within"
        helpText="An event is good when its duration is at most this long."
      >
        <Controller
          control={control}
          name="indicator.latency.thresholdMs"
          render={({ field, fieldState }) => (
            <NumberInput
              aria-label="Good within"
              suffix=" ms"
              decimalScale={3}
              clampBehavior="none"
              value={field.value}
              onChange={v => field.onChange(typeof v === 'number' ? v : 0)}
              error={fieldState.error?.message}
              w={180}
              data-testid="slo-latency-threshold"
            />
          )}
        />
        {expression !== '' && (
          <Text size="xs" c="dimmed" mt={4} data-testid="slo-latency-good-sql">
            Counted as good: {buildSloLatencyGoodSql(saved)}
          </Text>
        )}
      </SloFormRow>
    </>
  );
}
