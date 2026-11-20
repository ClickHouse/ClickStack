import { useEffect, useMemo, useState } from 'react';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import {
  displayTypeSupportsRawSqlAlerts,
  validateRawSqlChartConfig,
  validateRawSqlForAlert,
} from '@hyperdx/common-utils/dist/core/utils';
import { parseVariableReference } from '@hyperdx/common-utils/dist/referenceVariables';
import {
  ChartVariable,
  RawSqlChartConfig,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { DisplayType, isMetricSource } from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Box,
  Button,
  Group,
  List,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconHelpCircle } from '@tabler/icons-react';

import { ConnectionSelectControlled } from '@/components/ConnectionSelect';
import { AlertPanelButton } from '@/components/DBEditTimeChartForm/AlertPanelButton';
import { OnClickFormButton } from '@/components/DBEditTimeChartForm/OnClickForm/OnClickFormButton';
import { TileAlertEditor } from '@/components/DBEditTimeChartForm/TileAlertEditor';
import SourceSchemaPreview, {
  isSourceSchemaPreviewEnabled,
} from '@/components/SourceSchemaPreview';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { useResolvedReference } from '@/components/sourceSelectUtils';
import { SQLEditorControlled } from '@/components/SQLEditor/SQLEditor';
import { type SQLCompletion } from '@/components/SQLEditor/utils';
import { IS_LOCAL_MODE } from '@/config';
import useResizable from '@/hooks/useResizable';
import { useSources } from '@/source';
import { getTableConnectionsForConnection, usePrevious } from '@/utils';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';
import { resolveConnectionSourceSync } from '@/utils/connectionSourceSync';

import { SQL_PLACEHOLDERS } from './constants';
import { RawSqlChartInstructions } from './RawSqlChartInstructions';
import { ChartEditorFormState } from './types';
import { buildRawSqlCompletions } from './utils';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

export default function RawSqlChartEditor({
  control,
  setValue,
  allowedSourceKinds,
  onOpenDisplaySettings,
  onSubmit,
  isDashboardForm,
  alert,
  additionalWarnings,
  alertsEnabled,
  isAlertRequired,
  dashboardId,
  variables,
}: {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  allowedSourceKinds: SourceKind[];
  onOpenDisplaySettings: () => void;
  onSubmit: (suppressErrorNotification?: boolean) => void;
  isDashboardForm: boolean;
  alert: ChartEditorFormState['alert'];
  additionalWarnings?: string[];
  /** Whether this editor offers an alert (see EditTimeChartForm.enableAlerts). */
  alertsEnabled?: boolean;
  /** Hides the alert editor's remove control. */
  isAlertRequired?: boolean;
  dashboardId?: string;
  variables?: ChartVariable[];
}) {
  const { size, startResize } = useResizable(20, 'bottom');

  const { data: sources } = useSources();

  const displayType = useWatch({ control, name: 'displayType' });
  // Source and connection variable references autocomplete and expand macros
  // as the source and connection they currently select.
  const storedConnection = useWatch({ control, name: 'connection' });
  const connection = useResolvedReference(storedConnection);
  const storedSource = useWatch({ control, name: 'source' });
  const source = useResolvedReference(storedSource);
  const sqlTemplate = useWatch({ control, name: 'sqlTemplate' });
  const chartName = useWatch({ control, name: 'name' });
  const sourceObject = sources?.find(s => s.id === source);

  const rawSqlConfig = useMemo(
    () =>
      ({
        configType: 'sql',
        sqlTemplate: sqlTemplate ?? '',
        connection: connection ?? '',
        from: sourceObject?.from,
        metricTables:
          sourceObject && isMetricSource(sourceObject)
            ? sourceObject.metricTables
            : undefined,
        displayType,
        variables,
      }) satisfies RawSqlChartConfig,
    [sqlTemplate, connection, sourceObject, displayType, variables],
  );

  const [debouncedRawSqlConfig] = useDebouncedValue(rawSqlConfig, 300);

  const { alertErrorMessage, alertWarningMessage } = useMemo(() => {
    const { errors, warnings } = validateRawSqlForAlert(debouncedRawSqlConfig);
    const allWarnings = [...warnings, ...(additionalWarnings ?? [])];
    return {
      alertErrorMessage: errors.length > 0 ? errors.join(' ') : undefined,
      alertWarningMessage:
        allWarnings.length > 0 ? allWarnings.join(' ') : undefined,
    };
  }, [additionalWarnings, debouncedRawSqlConfig]);

  const { chartErrors, chartWarnings, sqlValidationAlertVariant } =
    useMemo(() => {
      const { errors, warnings } = validateRawSqlChartConfig(
        debouncedRawSqlConfig,
        { isDashboardTile: isDashboardForm },
      );

      return {
        chartErrors: errors,
        chartWarnings: warnings,
        sqlValidationAlertVariant: errors.length > 0 ? 'danger' : 'warning',
      };
    }, [debouncedRawSqlConfig, isDashboardForm]);

  const prevSource = usePrevious(storedSource);
  const prevConnection = usePrevious(connection);

  useEffect(() => {
    const update = resolveConnectionSourceSync({
      source: storedSource,
      connection,
      prevSource,
      prevConnection,
      sources,
    });
    // A connection variable stays as picked; the tile shows a mismatch
    // instead of having its reference replaced
    if (
      update?.field === 'connection' &&
      parseVariableReference(storedConnection) == null
    ) {
      setValue('connection', update.value);
    } else if (update?.field === 'source') {
      setValue('source', update.value);
    }
  }, [
    connection,
    storedConnection,
    prevConnection,
    prevSource,
    setValue,
    storedSource,
    sources,
  ]);

  const placeholderSQl = SQL_PLACEHOLDERS[displayType ?? DisplayType.Table];

  const additionalCompletions: SQLCompletion[] = useMemo(
    () => buildRawSqlCompletions({ displayType, variables }),
    [displayType, variables],
  );

  const [isSourceSchemaPreviewOpen, setIsSourceSchemaPreviewOpen] =
    useState(false);

  const tableConnections = useMemo(
    () => getTableConnectionsForConnection(sources, connection),
    [sources, connection],
  );

  const alertTooltip =
    displayType === DisplayType.Number
      ? 'The threshold will be evaluated against the last numeric column in the first query result'
      : 'The threshold will be evaluated against the last numeric column in each query result';

  const showAlertButton =
    alert != null ||
    (displayTypeSupportsRawSqlAlerts(displayType) &&
      alertsEnabled &&
      !IS_LOCAL_MODE);

  return (
    <Stack gap="xs">
      <Group align="center" gap={0} justify="space-between">
        <Group align="center" gap={0}>
          <Text pe="md" size="sm">
            Connection
          </Text>
          <ConnectionSelectControlled
            control={control}
            name="connection"
            size="xs"
            allowConnectionVariables
            data-testid="connection-selector"
          />
          <Group align="center" gap={8} mx="md">
            <Text size="sm" ps="md">
              Source
            </Text>
            {isDashboardForm && (
              <Tooltip
                label="Optional. Required to apply dashboard filters to this chart."
                pe="md"
              >
                <IconHelpCircle size={14} className="cursor-pointer" />
              </Tooltip>
            )}
          </Group>
          <SourceSelectControlled
            control={control}
            name="source"
            data-testid="source-selector"
            allowedSourceKinds={allowedSourceKinds}
            allowSourceVariables
            connectionId={connection}
            variableConnection={storedConnection}
            size="xs"
            clearable
            placeholder="None"
            onSchemaPreview={() => setIsSourceSchemaPreviewOpen(true)}
            isSchemaPreviewEnabled={isSourceSchemaPreviewEnabled(sourceObject)}
          />
          <SourceSchemaPreview
            source={sourceObject}
            controlled
            open={isSourceSchemaPreviewOpen}
            onClose={() => setIsSourceSchemaPreviewOpen(false)}
          />
        </Group>
        <Group gap="xs">
          {showAlertButton && (
            <AlertPanelButton
              hasAlert={alert != null}
              error={alertErrorMessage}
              warning={alertWarningMessage}
              onAddAlert={() =>
                setValue('alert', {
                  ...DEFAULT_TILE_ALERT,
                  ...(chartName && { displayName: chartName }),
                })
              }
            />
          )}
          <Group>
            {displayType === DisplayType.Table && (
              <OnClickFormButton
                control={control}
                setValue={setValue}
                onSubmit={onSubmit}
              />
            )}
            <Button
              onClick={onOpenDisplaySettings}
              size="compact-sm"
              variant="secondary"
            >
              Display Settings
            </Button>
          </Group>
        </Group>
      </Group>
      <RawSqlChartInstructions
        displayType={displayType ?? DisplayType.Table}
        variables={variables}
      />
      <Box style={{ position: 'relative' }}>
        <SQLEditorControlled
          control={control}
          name="sqlTemplate"
          height={`${size}vh`}
          enableLineWrapping
          placeholder={placeholderSQl}
          tableConnections={tableConnections}
          additionalCompletions={additionalCompletions}
          onSubmit={onSubmit}
        />
        <div className={resizeStyles.resizeYHandle} onMouseDown={startResize} />
      </Box>
      {(chartErrors.length > 0 || chartWarnings.length > 0) && (
        <Alert
          variant={sqlValidationAlertVariant}
          py="xs"
          data-testid="raw-sql-validation"
        >
          <List size="xs" spacing={2}>
            {chartErrors.map(message => (
              <List.Item key={message}>Error: {message}</List.Item>
            ))}
            {chartWarnings.map(message => (
              <List.Item key={message}>Warning: {message}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      {alert && (
        <TileAlertEditor
          control={control}
          setValue={setValue}
          alert={alert}
          dashboardId={dashboardId}
          onRemove={
            isAlertRequired ? undefined : () => setValue('alert', undefined)
          }
          error={alertErrorMessage}
          warning={alertWarningMessage}
          tooltip={alertTooltip}
        />
      )}
    </Stack>
  );
}
