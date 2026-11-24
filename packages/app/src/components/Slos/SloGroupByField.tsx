import { type Control, useFormState } from 'react-hook-form';
import type { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { SLO_MAX_GROUPS } from '@hyperdx/common-utils/dist/slo';
import { Input } from '@mantine/core';

import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

import type { SloFormValues } from './sloForm';
import { SloFormRow } from './SloFormLayout';

/** The optional expression whose values each get their own numbers. */
export function SloGroupByField({
  control,
  sourceId,
  tableConnection,
}: {
  control: Control<SloFormValues>;
  sourceId: string;
  tableConnection: TableConnection;
}) {
  const { errors } = useFormState({ control, name: 'groupBy' });
  return (
    <SloFormRow
      label="Group by"
      helpText={`Optional. Each value of this SQL expression gets its own SLI, error budget and alerts. The ${SLO_MAX_GROUPS} values with the most events are tracked.`}
    >
      <SQLInlineEditorControlled
        tableConnection={tableConnection}
        sourceId={sourceId}
        control={control}
        name="groupBy"
        placeholder="For example ServiceName"
        size="sm"
      />
      <Input.Error mt={4}>{errors.groupBy?.message}</Input.Error>
    </SloFormRow>
  );
}
