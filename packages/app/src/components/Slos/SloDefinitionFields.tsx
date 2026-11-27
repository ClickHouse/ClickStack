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
import { buildSloAvailabilityCondition } from '@hyperdx/common-utils/dist/core/slo';
import {
  SloTemplateSchema,
  SloWindowSchema,
} from '@hyperdx/common-utils/dist/slo';
import { SourceKind, type TSource } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Group,
  Input,
  NumberInput,
  Radio,
  TagsInput,
  Text,
  Textarea,
} from '@mantine/core';

import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

import { SloEligibleFilters } from './SloEligibleFilters';
import type { SloFormValues } from './sloForm';
import { SloFormRow } from './SloFormLayout';
import { SloLatencyFields } from './SloLatencyFields';
import { formatSloWindow } from './sloUtils';

const SLO_SOURCE_KINDS = [SourceKind.Trace, SourceKind.Log];
const TARGET_PRESETS = [99, 99.5, 99.9, 99.95];

/** Which events count, and which of them are good. */
export function SloIndicatorFields({
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
  const [sourceId, template] = useWatch({
    control,
    name: ['source', 'indicator.template'],
  });
  const { errors } = useFormState({ control, name: 'indicator.good' });
  const tableConnection = tcFromSource(source);

  // The availability condition starts from the source's status or severity
  // column. Switching sources replaces a seeded condition, never one the
  // user wrote.
  const seededGoodRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!source) return;
    const current = getValues('indicator.good').trim();
    const condition = buildSloAvailabilityCondition(source);
    if (current === '' || current === seededGoodRef.current) {
      setValue('indicator.good', condition ?? '', {
        shouldValidate: condition != null,
      });
    }
    seededGoodRef.current = condition;
  }, [source, getValues, setValue]);

  return (
    <>
      <SloFormRow
        label="Type"
        helpText="Availability: good events match a condition. Latency: good events finish within a threshold."
        inline
      >
        <Controller
          control={control}
          name="indicator.template"
          render={({ field }) => (
            <Radio.Group
              value={field.value}
              onChange={value => {
                const next = SloTemplateSchema.safeParse(value);
                if (next.success) field.onChange(next.data);
              }}
              aria-label="Type"
              data-testid="slo-template"
            >
              <Group>
                <Radio value="availability" label="Availability" />
                <Radio value="latency" label="Latency" />
              </Group>
            </Radio.Group>
          )}
        />
      </SloFormRow>
      <SloFormRow label="Source">
        {/* The select shows its own error. */}
        <div data-testid="slo-source">
          <SourceSelectControlled
            control={control}
            name="source"
            allowedSourceKinds={SLO_SOURCE_KINDS}
            size="sm"
          />
        </div>
      </SloFormRow>
      <SloFormRow
        label="Eligible events"
        helpText="The events the SLI counts. Leave empty to count every event in the source."
      >
        <SearchWhereInput
          tableConnection={tableConnection}
          control={control}
          name="indicator.eligible.where"
          sourceId={sourceId}
          size="sm"
          sqlPlaceholder="For example ServiceName = 'checkout'"
          lucenePlaceholder="For example ServiceName:checkout"
          data-testid="slo-eligible-input"
        />
        <SloEligibleFilters
          control={control}
          setValue={setValue}
          source={source}
        />
      </SloFormRow>
      {template === 'latency' ? (
        <SloLatencyFields
          control={control}
          getValues={getValues}
          setValue={setValue}
          source={source}
        />
      ) : (
        <SloFormRow
          label="Good events"
          helpText="The SQL condition a good event matches. An event where it evaluates to NULL counts as bad."
        >
          <SQLInlineEditorControlled
            tableConnection={tableConnection}
            sourceId={sourceId}
            control={control}
            name="indicator.good"
            placeholder="For example StatusCode != 'Error'"
            size="sm"
          />
          <Input.Error mt={4}>{errors.indicator?.good?.message}</Input.Error>
        </SloFormRow>
      )}
    </>
  );
}

/** The target and the rolling window it applies to. */
export function SloObjectiveFields({
  control,
  setValue,
}: {
  control: Control<SloFormValues>;
  setValue: UseFormSetValue<SloFormValues>;
}) {
  const [target, sloWindow] = useWatch({
    control,
    name: ['target', 'window'],
  });
  return (
    <>
      <SloFormRow
        label="Target"
        helpText="The share of eligible events that must be good over the window."
      >
        <Group gap="xs" align="flex-start" wrap="nowrap">
          <Controller
            control={control}
            name="target"
            render={({ field, fieldState }) => (
              <NumberInput
                aria-label="Target"
                suffix="%"
                decimalScale={3}
                step={0.1}
                // Out-of-range values get an error rather than a silent change.
                clampBehavior="none"
                value={field.value}
                onChange={v => field.onChange(typeof v === 'number' ? v : 0)}
                error={fieldState.error?.message}
                w={120}
                data-testid="slo-target"
              />
            )}
          />
          {TARGET_PRESETS.map(t => (
            <Button
              key={t}
              variant={target === t ? 'primary' : 'secondary'}
              onClick={() => setValue('target', t, { shouldValidate: true })}
            >
              {t}%
            </Button>
          ))}
        </Group>
        <Text size="xs" c="dimmed" mt={4}>
          Error budget: {Number((100 - (target ?? 0)).toFixed(3))}% of eligible
          events may be bad over {formatSloWindow(sloWindow)}.
        </Text>
      </SloFormRow>
      <SloFormRow
        label="Window"
        helpText="The SLI and the error budget cover this many days up to now."
        inline
      >
        <Controller
          control={control}
          name="window"
          render={({ field }) => (
            <Radio.Group
              value={field.value}
              onChange={value => {
                const next = SloWindowSchema.safeParse(value);
                if (next.success) field.onChange(next.data);
              }}
              aria-label="Window"
              data-testid="slo-window"
            >
              <Group>
                {SloWindowSchema.options.map(w => (
                  <Radio
                    key={w}
                    value={w}
                    label={`Rolling ${formatSloWindow(w)}`}
                  />
                ))}
              </Group>
            </Radio.Group>
          )}
        />
      </SloFormRow>
    </>
  );
}

/** What the SLO is for, and tags to find it by. */
export function SloDetailsFields({
  control,
}: {
  control: Control<SloFormValues>;
}) {
  return (
    <>
      <SloFormRow label="Description">
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <Textarea
              {...field}
              aria-label="Description"
              placeholder="Optional. What this SLO covers and who owns it."
              autosize
              minRows={2}
            />
          )}
        />
      </SloFormRow>
      <SloFormRow label="Tags">
        <Controller
          control={control}
          name="tags"
          render={({ field }) => (
            <TagsInput
              aria-label="Tags"
              value={field.value}
              onChange={field.onChange}
              clearable
            />
          )}
        />
      </SloFormRow>
    </>
  );
}
