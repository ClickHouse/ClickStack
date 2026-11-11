import React from 'react';
// The `mock` prefix is required for a jest.mock factory to close over it.
import { useController as mockUseController } from 'react-hook-form';
import {
  DisplayType,
  MetricsDataType,
  SavedChartConfig,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DBEditTimeChartForm from '@/components/DBEditTimeChartForm';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';

/**
 * These render the whole chart editor and drive it through user events, so
 * individual tests routinely exceed Jest's 5s default when the suite competes
 * for CPU with the rest of the run. Verified pre-existing: the slowest tests
 * here time out the same way on a clean origin/main checkout.
 */
jest.setTimeout(20_000);

// Delegates to per-test mocks: the extension is read once, at import.
const mockUseChartEditor = jest.fn();
jest.mock('@/extensions', () => ({
  alertUIExtension: {
    Provider: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="alert-ui-provider">{children}</div>
    ),
    useChartEditor: (form: unknown) => mockUseChartEditor(form),
  },
}));

// Mock the hooks that fetch data
jest.mock('@/hooks/useFetchMetricResourceAttrs', () => ({
  useFetchMetricResourceAttrs: jest.fn().mockReturnValue({
    data: [],
  }),
  parseAttributeKeysFromSuggestions: jest.fn().mockReturnValue([]),
}));

jest.mock('@/hooks/useFetchMetricMetadata', () => ({
  useFetchMetricMetadata: jest.fn().mockReturnValue({
    data: null,
  }),
}));

jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: jest.fn().mockReturnValue({}),
  useGetKeyValues: jest.fn().mockReturnValue({
    data: [
      {
        key: 'MetricName',
        value: ['test.metric.gauge', 'test.metric.sum'],
      },
    ],
  }),
  useGetValuesDistribution: jest.fn().mockReturnValue({
    data: undefined,
    isFetching: false,
    error: undefined,
  }),
}));

jest.mock('@/source', () => ({
  useSource: jest.fn().mockImplementation(props => {
    if (props && props.id === 'metric-source') {
      return {
        data: {
          id: 'metric-source',
          kind: SourceKind.Metric,
          name: 'Test Metric Source',
          from: {
            databaseName: 'default',
            tableName: '',
          },
          connection: 'default',
          timestampValueExpression: 'Timestamp',
          metricTables: {
            gauge: 'metrics.gauge',
            sum: 'metrics.sum',
            histogram: 'metrics.histogram',
          },
        },
      };
    }
    return { data: undefined };
  }),
  getFirstTimestampValueExpression: jest.fn().mockReturnValue('Timestamp'),
  getFirstSeriesNumberFormat: jest.fn().mockReturnValue(undefined),
  useSources: jest.fn().mockReturnValue({ data: [] }),
}));

// Records every render's props so tests can assert what the form passes down.
const metricNameSelectProps: any[] = [];

// What the stubbed explorer reports as staged when a metric is applied. The
// `mock` prefix is required for a jest.mock factory to close over it.
const mockStagedWhere: string[] = [];
const mockStagedGroupBy: string[] = [];

// TileAlertEditor asks before removing an alert; these tests always confirm.
// The `mock` prefix is required for a jest.mock factory to close over it.
const mockConfirm = jest.fn().mockResolvedValue(true);
jest.mock('@/useConfirm', () => ({ useConfirm: () => mockConfirm }));

// The explorer has its own suite (MetricExplorer.test.tsx). Here it is stubbed
// down to "emit a chosen metric", so these tests cover only the form wiring —
// mounting the real tree six times pushed this suite past the 5s-per-test
// budget under parallel load.
jest.mock('@/components/MetricExplorer/MetricExplorerModal', () => ({
  MetricExplorerModal: ({
    opened,
    onApply,
  }: {
    opened: boolean;
    onApply: (selection: {
      name: string;
      type: string;
      where: string[];
      groupBy: string[];
    }) => void;
  }) =>
    opened ? (
      <div data-testid="metric-explorer-stub">
        {(
          [
            ['gauge', 'test.metric.gauge'],
            ['sum', 'test.metric.counter'],
            ['histogram', 'test.metric.latency'],
          ] as const
        ).map(([type, name]) => (
          <button
            key={type}
            type="button"
            data-testid={`metric-explorer-pick-${type}`}
            onClick={() =>
              onApply({
                name,
                type,
                where: mockStagedWhere,
                groupBy: mockStagedGroupBy,
              })
            }
          >
            {name}
          </button>
        ))}
      </div>
    ) : null,
}));

jest.mock('../../MetricNameSelect', () => ({
  MetricNameSelect: (props: any) => {
    metricNameSelectProps.push(props);
    const { error, onFocus, setMetricName, metricName } = props;
    const testId = props['data-testid'];
    return (
      <div>
        <select
          data-testid={testId}
          value={metricName || ''}
          onChange={(e: any) => setMetricName(e.target.value)}
          onFocus={onFocus}
          aria-invalid={!!error}
        >
          <option value="">Select a metric...</option>
          <option value="test.metric.gauge">test.metric.gauge</option>
          <option value="test.metric.sum">test.metric.sum</option>
        </select>
        {error && <div data-testid="metric-name-error">{error}</div>}
      </div>
    );
  },
}));

// Wired into form state rather than a static select, so tests can switch the
// tile's source the way a user does.
jest.mock('../../SourceSelect', () => ({
  SourceSelectControlled: ({ control, name }: any) => {
    const { field } = mockUseController({ control, name });
    return (
      <select
        data-testid="source-selector"
        value={field.value ?? ''}
        onChange={event => field.onChange(event.target.value)}
      >
        <option value="metric-source">Metric Source</option>
        <option value="log-source">Logs</option>
        <option value="other-source">Other Source</option>
      </select>
    );
  },
}));

jest.mock('../../ChartSQLPreview', () => ({
  __esModule: true,
  default: () => <div>Chart SQL Preview</div>,
}));

jest.mock('../../DBTimeChart', () => ({
  DBTimeChart: () => <div>Time Chart</div>,
}));

jest.mock('../../DBTableChart', () => ({
  __esModule: true,
  default: () => <div>Table Chart</div>,
}));

jest.mock('../../DBNumberChart', () => ({
  __esModule: true,
  default: () => <div>Number Chart</div>,
}));

jest.mock('@/components/SearchInput/SearchInputV2', () => ({
  __esModule: true,
  default: () => <div>Search Input</div>,
}));

// The sample-events panel (rendered for event sources) reads Next router
// query state via nuqs, which isn't mounted in this test environment.
jest.mock('@/components/DBSqlRowTableWithSidebar', () => ({
  __esModule: true,
  default: () => <div>SQL Row Table</div>,
}));

jest.mock('../../MaterializedViews/MVOptimizationIndicator', () => ({
  __esModule: true,
  default: () => <div>MV Indicator</div>,
}));

jest.mock('../../SQLEditor/SQLInlineEditor', () => ({
  SQLInlineEditorControlled: () => <div>SQL Editor</div>,
}));

jest.mock('@/HDXMarkdownChart', () => ({
  __esModule: true,
  default: () => <div>Markdown Chart</div>,
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const defaultChartConfig: SavedChartConfig = {
  name: 'Test Chart',
  source: 'metric-source',
  displayType: DisplayType.Line,
  select: [
    {
      aggFn: 'avg',
      aggCondition: '',
      aggConditionLanguage: 'lucene' as const,
      valueExpression: '',
      metricType: MetricsDataType.Gauge,
      metricName: '',
    },
  ],
  where: '',
  whereLanguage: 'lucene',
  granularity: 'auto',
  alignDateRangeToGranularity: true,
};

const renderComponent = (
  props: Partial<React.ComponentProps<typeof DBEditTimeChartForm>> = {},
) => {
  return renderWithMantine(
    <QueryClientProvider client={queryClient}>
      <DBEditTimeChartForm
        chartConfig={defaultChartConfig}
        dateRange={[new Date('2024-01-01'), new Date('2024-01-02')]}
        {...props}
      />
    </QueryClientProvider>,
  );
};

const series = {
  aggFn: 'avg' as const,
  aggCondition: '',
  aggConditionLanguage: 'lucene' as const,
  valueExpression: 'Value',
  metricType: MetricsDataType.Gauge,
  metricName: 'test.metric.gauge',
};

// Stable across renders, as the extension contract requires.
const blockSave = jest.fn(() => false);
const raiseThreshold = <T,>(alert: T): T =>
  alert == null ? alert : { ...alert, threshold: 99 };

describe('DBEditTimeChartForm with an alert UI extension', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseChartEditor.mockReturnValue({});
  });

  it('wraps the editor in the extension provider', () => {
    renderComponent({ onSave: jest.fn() });

    expect(screen.getByTestId('alert-ui-provider')).toContainElement(
      screen.getByTestId('chart-save-button'),
    );
    expect(mockUseChartEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        watch: expect.any(Function),
        getValues: expect.any(Function),
        setValue: expect.any(Function),
      }),
    );
  });

  it('does not save when beforeSave returns false', async () => {
    mockUseChartEditor.mockReturnValue({ beforeSave: blockSave });
    const onSave = jest.fn();
    renderComponent({
      chartConfig: { ...defaultChartConfig, select: [series] },
      onSave,
    });

    await userEvent.click(screen.getByTestId('chart-save-button'));

    await waitFor(() => expect(blockSave).toHaveBeenCalledTimes(1));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves the alert normalizeAlert returns', async () => {
    mockUseChartEditor.mockReturnValue({ normalizeAlert: raiseThreshold });
    const onSave = jest.fn();
    renderComponent({
      chartConfig: {
        ...defaultChartConfig,
        select: [series],
        alert: {
          ...DEFAULT_TILE_ALERT,
          channels: [{ type: 'webhook', webhookId: 'hook-1' }],
        },
      },
      dashboardId: 'dashboard-1',
      onSave,
    });

    await userEvent.click(screen.getByTestId('chart-save-button'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].alert).toMatchObject({ threshold: 99 });
  });
});
