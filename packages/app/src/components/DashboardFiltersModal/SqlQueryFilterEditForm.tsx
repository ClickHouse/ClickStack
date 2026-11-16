import { useMemo, useState } from 'react';
import { useFormState, useWatch } from 'react-hook-form';
import { MACRO_SUGGESTIONS } from '@hyperdx/common-utils/dist/macros';
import {
  DashboardFilter,
  SqlQueryDashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react';

import { ConnectionSelectControlled } from '@/components/ConnectionSelect';
import EmptyState from '@/components/EmptyState';
import { SQLEditorControlled } from '@/components/SQLEditor/SQLEditor';
import {
  buildSqlVariableCompletions,
  toMacroCompletion,
  useChartVariables,
} from '@/components/SQLEditor/variableCompletions';
import { NOW } from '@/config';
import { useSqlQueryFilterValues } from '@/hooks/useSqlQueryFilterValues';
import { truncateText } from '@/utils';

import { CustomInputWrapper } from './CustomInputWrapper';
import { FilterFormControl } from './filterFormState';
import { VariableNameInput } from './VariableNameInput';

/** Values the preview lists before summarizing the rest as a count. */
const PREVIEW_VALUES_SHOWN = 20;
/** Characters of each value the preview shows before truncating it. */
const PREVIEW_VALUE_MAX_LENGTH = 20;

/** Macros that need a source, which a SQL query filter doesn't have. */
const SOURCE_MACROS = new Set(['filters', 'sourceTable']);

const PLACEHOLDER_SQL = `SELECT DISTINCT env
FROM default.environments
WHERE $__filter(cloud, $cloud)
ORDER BY env`;

interface SqlQueryFilterEditFormProps {
  control: FilterFormControl;
  /** Filters other than the one being edited, used to keep variable names unique. */
  otherFilters: DashboardFilter[];
  /** The range the preview runs over. Defaults to the last hour. */
  dateRange?: [Date, Date];
}

/** Form describing a dashboard filter whose values come from a SQL query */
export const SqlQueryFilterEditForm = ({
  control,
  otherFilters,
  dateRange,
}: SqlQueryFilterEditFormProps) => {
  const { errors } = useFormState({ control });
  const variables = useChartVariables();
  const completions = useMemo(
    () => [
      ...MACRO_SUGGESTIONS.filter(
        // `sourceTable(gauge)` etc. are per-metric variants of `sourceTable`.
        macro => !SOURCE_MACROS.has(macro.name.split('(')[0]),
      ).map(toMacroCompletion),
      ...buildSqlVariableCompletions(variables),
    ],
    [variables],
  );

  const [connection, sqlTemplate] = useWatch({
    control,
    name: ['connection', 'sqlTemplate'],
  });
  // What the preview last ran, so editing doesn't re-query on every keystroke.
  const [previewed, setPreviewed] = useState<{
    connection: string;
    sqlTemplate: string;
  }>();
  const canPreview = !!connection && !!sqlTemplate?.trim();
  const runPreview = () => {
    if (canPreview) setPreviewed({ connection, sqlTemplate });
  };

  return (
    <>
      <CustomInputWrapper
        label="Connection"
        tooltipText="The ClickHouse connection the query runs on"
        error={errors.connection}
      >
        <div data-testid="filter-connection-select">
          <ConnectionSelectControlled
            control={control}
            name="connection"
            rules={{ required: 'Select a connection' }}
          />
        </div>
      </CustomInputWrapper>

      <CustomInputWrapper
        label="SQL query"
        tooltipText="The first column of the results fills the dropdown, in the order the query returns them. The query may use the time macros and reference the dashboard's other variables."
        error={errors.sqlTemplate}
      >
        <Stack gap="xs" data-testid="filter-sql-template-input">
          <SQLEditorControlled
            control={control}
            name="sqlTemplate"
            rules={{
              validate: (value: unknown) =>
                (typeof value === 'string' && value.trim().length > 0) ||
                'This field is required',
            }}
            height="150px"
            enableLineWrapping
            placeholder={PLACEHOLDER_SQL}
            additionalCompletions={completions}
            onSubmit={runPreview}
          />
          <Group justify="flex-end">
            <Button
              variant="secondary"
              size="compact-sm"
              leftSection={<IconPlayerPlay size={14} />}
              disabled={!canPreview}
              onClick={runPreview}
              data-testid="filter-sql-preview-button"
            >
              Preview values
            </Button>
          </Group>
          {previewed && (
            <SqlQueryFilterPreview
              {...previewed}
              dateRange={dateRange}
              variables={variables}
            />
          )}
        </Stack>
      </CustomInputWrapper>

      <VariableNameInput control={control} otherFilters={otherFilters} />
    </>
  );
};

const SqlQueryFilterPreview = ({
  connection,
  sqlTemplate,
  dateRange,
  variables,
}: {
  connection: string;
  sqlTemplate: string;
  dateRange?: [Date, Date];
  variables: ReturnType<typeof useChartVariables>;
}) => {
  const lastHour = useMemo(
    (): [Date, Date] => [new Date(NOW - 60 * 60 * 1000), new Date(NOW)],
    [],
  );
  const filters = useMemo(
    (): SqlQueryDashboardFilter[] => [
      {
        id: 'preview',
        type: 'SQL_QUERY',
        name: 'Preview',
        connection,
        sqlTemplate,
        isBroadcastEnabled: false,
        isVariableEnabled: true,
      },
    ],
    [connection, sqlTemplate],
  );
  const { data, filterErrorMessages, isLoading, isError } =
    useSqlQueryFilterValues({
      filters,
      dateRange: dateRange ?? lastHour,
      variables,
    });
  const values = data.get('preview')?.values ?? [];

  if (isLoading) {
    return (
      <Group gap="xs" data-testid="filter-sql-preview">
        <Loader size="xs" />
        <Text size="xs">Running query</Text>
      </Group>
    );
  }

  if (isError) {
    return (
      <Alert
        variant="danger"
        icon={<IconAlertTriangle size={16} />}
        data-testid="filter-sql-preview"
      >
        {filterErrorMessages.get('preview') ?? 'The query failed.'}
      </Alert>
    );
  }

  if (values.length === 0) {
    return (
      <div data-testid="filter-sql-preview">
        <EmptyState
          title="No values"
          description="The query returned no rows for the dashboard's time range."
        />
      </div>
    );
  }

  const notShown = values.length - PREVIEW_VALUES_SHOWN;
  return (
    <Stack gap={4} data-testid="filter-sql-preview">
      <Text size="xs" fw={500}>
        {values.length} {values.length === 1 ? 'value' : 'values'}
      </Text>
      <Text size="xs" data-testid="filter-sql-preview-values">
        {values.slice(0, PREVIEW_VALUES_SHOWN).map((value, index) => (
          <span key={value}>
            {index > 0 && ', '}
            <span title={value}>
              {truncateText(value, PREVIEW_VALUE_MAX_LENGTH, '…')}
            </span>
          </span>
        ))}
        {notShown > 0 && `, and ${notShown} more`}
      </Text>
    </Stack>
  );
};
