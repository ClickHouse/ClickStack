import React from 'react';
import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { ChartPreviewPanel } from '@/components/DBEditTimeChartForm/ChartPreviewPanel';

const mockUseTimeChartPreview = jest.fn();
jest.mock('@/extensions', () => ({
  alertUIExtension: {
    useTimeChartPreview: (args: unknown) => mockUseTimeChartPreview(args),
  },
}));

const mockTimeChartProps = jest.fn();
jest.mock('@/components/DBTimeChart', () => ({
  DBTimeChart: (props: Record<string, unknown>) => {
    mockTimeChartProps(props);
    return <div data-testid="db-time-chart" />;
  },
}));
jest.mock('@/components/ChartSQLPreview', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/source', () => ({
  getFirstTimestampValueExpression: jest.fn().mockReturnValue('Timestamp'),
  useSource: () => ({ data: undefined }),
}));

const dateRange: [Date, Date] = [
  new Date('2024-01-01'),
  new Date('2024-01-02'),
];
const config = {
  timestampValueExpression: 'Timestamp',
  connection: 'default',
  from: { databaseName: 'default', tableName: 'logs' },
  select: [{ aggFn: 'count' as const, valueExpression: '' }],
  where: '',
  granularity: 'auto' as const,
  dateRange,
};
const alert = {
  threshold: 5,
  thresholdType: AlertThresholdType.ABOVE,
  interval: '5m' as const,
  channels: [],
};

const renderPanel = () =>
  renderWithMantine(
    <ChartPreviewPanel
      dateRange={dateRange}
      activeTab="time"
      showGeneratedSql={false}
      showSampleEvents={false}
      showGeneratedPromql={false}
      setValue={jest.fn()}
      setDisplayType={jest.fn()}
      onSubmit={jest.fn()}
      queriedConfig={config}
      dbTimeChartConfig={config}
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the preview reads only these alert fields
      alert={alert as React.ComponentProps<typeof ChartPreviewPanel>['alert']}
    />,
  );

const lastTimeChartProps = () =>
  mockTimeChartProps.mock.calls[mockTimeChartProps.mock.calls.length - 1][0];

describe('ChartPreviewPanel with an alert UI extension', () => {
  beforeEach(() => {
    mockUseTimeChartPreview.mockReset();
    mockTimeChartProps.mockReset();
  });

  it('previews the threshold when the extension supplies nothing', () => {
    mockUseTimeChartPreview.mockReturnValue({});
    renderPanel();

    expect(lastTimeChartProps().config).toBe(config);
    expect(lastTimeChartProps().referenceLines).toBeTruthy();
    expect(mockUseTimeChartPreview).toHaveBeenCalledWith(
      expect.objectContaining({ alert, config, enabled: true }),
    );
  });

  it('applies the config, chart props and footer the extension supplies', () => {
    const windowed = { ...config, granularity: '1 minute' as const };
    mockUseTimeChartPreview.mockReturnValue({
      config: windowed,
      hideThresholdLines: true,
      timeChartProps: { showLegend: false },
      footer: <div data-testid="ext-preview-footer" />,
    });
    renderPanel();

    const props = lastTimeChartProps();
    expect(props.config).toBe(windowed);
    expect(props.referenceLines).toBeUndefined();
    expect(props.referenceLineValues).toBeUndefined();
    expect(props.showLegend).toBe(false);
    expect(screen.getByTestId('ext-preview-footer')).toBeInTheDocument();
  });
});
