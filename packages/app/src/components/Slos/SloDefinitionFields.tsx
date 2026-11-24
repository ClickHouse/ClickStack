import { useEffect, useRef } from 'react';
import {
  type Control,
  type UseFormGetValues,
  type UseFormSetValue,
  useFormState,
  useWatch,
} from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { buildSloAvailabilityCondition } from '@hyperdx/common-utils/dist/core/slo';
import { SourceKind, type TSource } from '@hyperdx/common-utils/dist/types';
import { Input } from '@mantine/core';

import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

import type { SloFormValues } from './sloForm';
import { SloFormRow } from './SloFormLayout';

const SLO_SOURCE_KINDS = [SourceKind.Trace, SourceKind.Log];

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
  const sourceId = useWatch({ control, name: 'source' });
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
      </SloFormRow>
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
    </>
  );
}
