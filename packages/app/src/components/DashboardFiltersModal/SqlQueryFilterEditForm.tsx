import { useEffect, useMemo, useState } from 'react';
import { UseFormSetValue, useFormState, useWatch } from 'react-hook-form';
import {
  getSqlQueryFilterSourceTables,
  SQL_QUERY_FILTER_SOURCE_KINDS,
  SqlQueryFilterSourceTables,
  validateSqlQueryFilterTemplate,
} from '@hyperdx/common-utils/dist/filters';
import {
  INTERVAL_MACROS,
  MACRO_SUGGESTIONS,
  SOURCE_DEPENDENT_MACROS,
} from '@hyperdx/common-utils/dist/macros';
import { parseVariableReference } from '@hyperdx/common-utils/dist/referenceVariables';
import {
  BroadcastFilter,
  DashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';

import { ConnectionSelectControlled } from '@/components/ConnectionSelect';
import EmptyState from '@/components/EmptyState';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { useResolvedReference } from '@/components/sourceSelectUtils';
import { SQLEditorControlled } from '@/components/SQLEditor/SQLEditor';
import {
  buildSqlVariableCompletions,
  toMacroCompletion,
  useChartVariables,
} from '@/components/SQLEditor/variableCompletions';
import { NOW } from '@/config';
import { SqlQueryFilterPreviewOptions } from '@/hooks/useSqlQueryFilterGeneratedSql';
import {
  SQL_QUERY_FILTER_VALUES_QUERY_KEY,
  useSqlQueryFilterValues,
} from '@/hooks/useSqlQueryFilterValues';
import { useSources } from '@/source';
import {
  getTableConnectionsForConnection,
  truncateText,
  usePrevious,
} from '@/utils';
import { resolveConnectionSourceSync } from '@/utils/connectionSourceSync';

import { TOOLTIP_PORTAL_TARGET } from './constants';
import { CustomInputWrapper } from './CustomInputWrapper';
import { FilterFormControl, FilterFormValues } from './filterFormState';
import { SqlQueryFilterGeneratedSql } from './SqlQueryFilterGeneratedSql';
import { VariableNameInput } from './VariableNameInput';

/** Values the preview lists before summarizing the rest as a count. */
const PREVIEW_VALUES_SHOWN = 20;
/** Characters of each value the preview shows before truncating it. */
const PREVIEW_VALUE_MAX_LENGTH = 20;

/** Macros a SQL query filter can't expand: it has no time buckets. */
const UNSUPPORTED_MACROS = new Set<string>(INTERVAL_MACROS);
/** Without a source, the source macros can't expand either. */
const UNSUPPORTED_MACROS_WITHOUT_SOURCE = new Set<string>([
  ...SOURCE_DEPENDENT_MACROS,
  ...INTERVAL_MACROS,
]);

const PLACEHOLDER_SQL = `SELECT DISTINCT env
FROM default.environments
WHERE $__filter(cloud, $cloud)
ORDER BY env`;

interface SqlQueryFilterEditFormProps {
  control: FilterFormControl;
  setValue: UseFormSetValue<FilterFormValues>;
  /** Filters other than the one being edited, used to keep variable names unique. */
  otherFilters: DashboardFilter[];
  /** The range the preview runs over. Defaults to the last hour. */
  dateRange?: [Date, Date];
  /** The dashboard filter selections that broadcast to the given source */
  getDashboardFilters?: (sourceId: string) => BroadcastFilter[];
}

/** Form describing a dashboard filter whose values come from a SQL query */
export const SqlQueryFilterEditForm = ({
  control,
  setValue,
  otherFilters,
  dateRange,
  getDashboardFilters,
}: SqlQueryFilterEditFormProps) => {
  const { errors } = useFormState({ control });
  const variables = useChartVariables();
  const { data: sources } = useSources();

  const [connection, source, sqlTemplate] = useWatch({
    control,
    name: ['connection', 'source', 'sqlTemplate'],
  });
  const isSourceVariable = parseVariableReference(source) != null;
  // Source and connection variables preview, and are validated, as the source
  // and connection they currently select.
  const resolvedSource = useResolvedReference(source);
  const resolvedConnection = useResolvedReference(connection);
  const sourceObject = resolvedSource
    ? sources?.find(s => s.id === resolvedSource)
    : undefined;
  const storedSourceObject = isSourceVariable ? undefined : sourceObject;

  const prevSource = usePrevious(source);
  const prevConnection = usePrevious(resolvedConnection);
  useEffect(() => {
    // The source field is shared with the other filter types, so switching
    // type can carry over one this filter can't use.
    if (
      source &&
      !isSourceVariable &&
      sources &&
      (!storedSourceObject ||
        !SQL_QUERY_FILTER_SOURCE_KINDS.includes(storedSourceObject.kind))
    ) {
      setValue('source', '');
      return;
    }
    const update = resolveConnectionSourceSync({
      source,
      connection: resolvedConnection,
      prevSource,
      prevConnection,
      sources,
    });
    // A connection variable stays as picked, as on raw SQL tiles
    if (
      update?.field === 'connection' &&
      parseVariableReference(connection) == null
    ) {
      setValue('connection', update.value);
    } else if (update?.field === 'source') {
      setValue('source', update.value);
    }
  }, [
    connection,
    isSourceVariable,
    prevConnection,
    prevSource,
    resolvedConnection,
    setValue,
    source,
    storedSourceObject,
    sources,
  ]);

  const completions = useMemo(() => {
    const unsupported = source
      ? UNSUPPORTED_MACROS
      : UNSUPPORTED_MACROS_WITHOUT_SOURCE;
    return [
      ...MACRO_SUGGESTIONS.filter(
        // `sourceTable(gauge)` etc. are per-metric variants of `sourceTable`.
        macro => !unsupported.has(macro.name.split('(')[0]),
      ).map(toMacroCompletion),
      ...buildSqlVariableCompletions(variables),
    ];
  }, [variables, source]);

  // What the preview last ran, so editing doesn't re-query on every keystroke.
  const [previewed, setPreviewed] = useState<{
    connection: string;
    source?: string;
    sqlTemplate: string;
  }>();
  const lastHour = useMemo(
    (): [Date, Date] => [new Date(NOW - 60 * 60 * 1000), new Date(NOW)],
    [],
  );
  const preview = useMemo(
    (): SqlQueryFilterPreviewOptions | undefined =>
      previewed && {
        filter: {
          id: 'preview',
          type: 'SQL_QUERY',
          name: 'Preview',
          ...previewed,
          isBroadcastEnabled: false,
          isVariableEnabled: true,
        },
        dateRange: dateRange ?? lastHour,
        variables,
        getDashboardFilters,
      },
    [previewed, dateRange, lastHour, variables, getDashboardFilters],
  );
  const unresolvedVariables = [
    !resolvedConnection && parseVariableReference(connection) != null
      ? connection
      : undefined,
    isSourceVariable && !resolvedSource ? source : undefined,
  ].filter((value): value is string => !!value);
  const canPreview =
    !!resolvedConnection &&
    !!sqlTemplate?.trim() &&
    unresolvedVariables.length === 0;
  const tableConnections = useMemo(
    () => getTableConnectionsForConnection(sources, resolvedConnection),
    [sources, resolvedConnection],
  );
  const queryClient = useQueryClient();
  const runPreview = () => {
    if (!canPreview) return;
    const previewSource = resolvedSource || undefined;
    // The same query keeps its cache key, so re-run it explicitly.
    if (
      previewed?.connection === resolvedConnection &&
      previewed.source === previewSource &&
      previewed.sqlTemplate === sqlTemplate
    ) {
      void queryClient.invalidateQueries({
        queryKey: [SQL_QUERY_FILTER_VALUES_QUERY_KEY, resolvedConnection],
      });
    }
    setPreviewed({
      connection: resolvedConnection,
      source: previewSource,
      sqlTemplate,
    });
  };

  let sourceTables: SqlQueryFilterSourceTables | 'unknown' | undefined;
  if (storedSourceObject) {
    sourceTables = getSqlQueryFilterSourceTables(storedSourceObject);
  } else if (source) {
    // A variable can later select a source with other tables, and a source ID
    // may be set before the sources list loads.
    sourceTables = 'unknown';
  }

  const validateSqlTemplate = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) {
      return 'This field is required';
    }
    // `variables` leaves out this filter's own, so a reference to it is
    // rejected as unknown.
    const error = validateSqlQueryFilterTemplate(value, {
      variables,
      sourceTables,
    });
    return error ?? true;
  };

  return (
    <>
      <Group grow align="flex-start">
        <CustomInputWrapper
          label="Connection"
          tooltipText="The ClickHouse connection the query runs on, which can be a connection variable"
          error={errors.connection}
        >
          <div data-testid="filter-connection-select">
            <ConnectionSelectControlled
              control={control}
              name="connection"
              rules={{ required: 'Select a connection' }}
              allowConnectionVariables
            />
          </div>
        </CustomInputWrapper>

        <CustomInputWrapper
          label="Source"
          tooltipText="Optional. Lets the query use $__sourceTable and $__filters, which applies the dashboard's filter selections for this source. Can be a data source variable."
        >
          {/* The source select's wrapper is inline-flex; a grid cell
              stretches it to the full width. */}
          <div
            data-testid="filter-sql-source-select"
            style={{ display: 'grid' }}
          >
            <SourceSelectControlled
              flex={1}
              control={control}
              name="source"
              allowedSourceKinds={SQL_QUERY_FILTER_SOURCE_KINDS}
              allowSourceVariables
              connectionId={resolvedConnection}
              variableConnection={connection}
              clearable
              placeholder="None"
              comboboxProps={{ withinPortal: true }}
            />
          </div>
        </CustomInputWrapper>
      </Group>

      <CustomInputWrapper
        label="SQL query"
        tooltipText="The first column of the results fills the dropdown, in the order the query returns them. The query may use the time macros and reference the dashboard's other variables. With a source, it may also use $__sourceTable and $__filters."
        error={errors.sqlTemplate}
      >
        <Stack gap="xs" data-testid="filter-sql-template-input">
          <SQLEditorControlled
            control={control}
            name="sqlTemplate"
            rules={{ validate: validateSqlTemplate }}
            height="150px"
            enableLineWrapping
            placeholder={PLACEHOLDER_SQL}
            tableConnections={tableConnections}
            additionalCompletions={completions}
            onSubmit={runPreview}
            parentRef={TOOLTIP_PORTAL_TARGET}
          />
          <Group justify="flex-end">
            {unresolvedVariables.length > 0 && (
              <Text size="xs" c="dimmed">
                Select a value for {unresolvedVariables.join(' and ')} to
                preview
              </Text>
            )}
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
          {preview && (
            <>
              <SqlQueryFilterPreview {...preview} />
              <SqlQueryFilterGeneratedSql {...preview} />
            </>
          )}
        </Stack>
      </CustomInputWrapper>

      <VariableNameInput control={control} otherFilters={otherFilters} />
    </>
  );
};

const SqlQueryFilterPreview = ({
  filter,
  dateRange,
  variables,
  getDashboardFilters,
}: SqlQueryFilterPreviewOptions) => {
  const filters = useMemo(() => [filter], [filter]);
  const { data, filterErrorMessages, isLoading, isFetching, isError } =
    useSqlQueryFilterValues({
      filters,
      dateRange,
      variables,
      getDashboardFilters,
    });
  const values = data.get(filter.id)?.values ?? [];

  // While a re-run loads, the previous query's values stand in as placeholder
  // data, so isLoading alone would show them as this query's results.
  if (isLoading || isFetching) {
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
        {filterErrorMessages.get(filter.id) ?? 'The query failed.'}
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
