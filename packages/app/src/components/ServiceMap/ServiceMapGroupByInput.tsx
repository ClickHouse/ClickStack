import { Control, useFormState } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { Box, Text } from '@mantine/core';

import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { MAX_SERVICE_MAP_GROUP_BY } from '@/hooks/useServiceMap';

export type ServiceMapSearchFormValues = {
  source?: string;
  where: string;
  whereLanguage: 'sql' | 'lucene';
  // Comma-separated extra group-by SQL expressions.
  groupBy: string;
};

function validateGroupBy(value: string): true | string {
  return (
    splitAndTrimWithBracket(value).length <= MAX_SERVICE_MAP_GROUP_BY ||
    `Up to ${MAX_SERVICE_MAP_GROUP_BY} group by expressions`
  );
}

/** The "Group by" SQL editor, with the expression-count validation inline. */
export default function ServiceMapGroupByInput({
  control,
  tableConnection,
  sourceId,
  dateRange,
  onSubmit,
}: {
  control: Control<ServiceMapSearchFormValues>;
  tableConnection: TableConnection;
  sourceId: string;
  dateRange: [Date, Date];
  onSubmit: () => void;
}) {
  const { errors } = useFormState({ control, name: 'groupBy' });

  return (
    <Box
      flex={1}
      miw="min(320px, 100%)"
      data-testid="service-map-group-by-input"
    >
      <SQLInlineEditorControlled
        tableConnection={tableConnection}
        sourceId={sourceId}
        control={control}
        name="groupBy"
        rules={{ validate: validateGroupBy }}
        label="Group by"
        placeholder="ResourceAttributes['k8s.pod.name']"
        tooltipText="Split services by up to 3 resource attributes, e.g. pod, node or version. Span attributes describe each call, so they split callers by the callee's values."
        onSubmit={onSubmit}
        disableKeywordAutocomplete
        dateRange={dateRange}
        size="xs"
      />
      {errors.groupBy?.message ? (
        <Text
          variant="danger"
          size="xs"
          mt={2}
          data-testid="service-map-group-by-error"
        >
          {errors.groupBy.message}
        </Text>
      ) : null}
    </Box>
  );
}
