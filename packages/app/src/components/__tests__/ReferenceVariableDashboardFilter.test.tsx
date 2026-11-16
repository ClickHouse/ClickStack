import {
  DataSourceDashboardFilter as DataSourceFilter,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DataSourceDashboardFilter } from '@/components/ReferenceVariableDashboardFilter';

jest.mock('@/source', () => ({
  useSources: () => ({ data: mockSources }),
}));

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const makeSource = (
  id: string,
  name: string,
  kind: SourceKind,
  connection = 'conn-a',
) => ({ id, name, kind, connection });

const mockSources = [
  makeSource('logs-a', 'Logs A', SourceKind.Log),
  makeSource('logs-b', 'Logs B', SourceKind.Log),
  makeSource('logs-c', 'Logs C', SourceKind.Log, 'conn-b'),
  makeSource('traces', 'Traces', SourceKind.Trace),
];

const filter: DataSourceFilter = {
  id: 'ds',
  type: 'DATA_SOURCE',
  name: 'Logs source',
  variableName: 'logs',
  allowedSourceKinds: [SourceKind.Log],
  minSelections: 1,
  maxSelections: 1,
  isBroadcastEnabled: false,
  isVariableEnabled: true,
};

const renderFilter = (
  value: string | undefined,
  onChange = jest.fn(),
  overrides: Partial<DataSourceFilter> = {},
  pendingVariables?: string[],
) =>
  renderWithMantine(
    <DataSourceDashboardFilter
      filter={{ ...filter, ...overrides }}
      pendingVariables={pendingVariables}
      value={value}
      onChange={onChange}
      effect={{ hasEffect: true, tooltip: '' }}
      requiredTooltip="Required"
    />,
  );

const select = () => screen.getByTestId('dashboard-filter-select-Logs source');

describe('DataSourceDashboardFilter', () => {
  it('offers only sources of the allowed kinds and reports the picked one', async () => {
    const onChange = jest.fn();
    renderFilter(undefined, onChange);

    await userEvent.click(select());
    expect(await screen.findByText('Logs A')).toBeInTheDocument();
    expect(screen.queryByText('Traces')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Logs B'));
    expect(onChange).toHaveBeenCalledWith('logs-b');
  });

  it('shows the selected source and no required caution', () => {
    renderFilter('logs-a');

    expect(select()).toHaveValue('Logs A');
    expect(
      screen.queryByTestId('dashboard-filter-required-Logs source'),
    ).not.toBeInTheDocument();
  });

  it('treats a selection it no longer offers as unselected', () => {
    renderFilter('traces');

    expect(select()).toHaveValue('');
    expect(
      screen.getByTestId('dashboard-filter-required-Logs source'),
    ).toBeInTheDocument();
  });

  it('offers only the sources on its connection', async () => {
    renderFilter(undefined, jest.fn(), { connection: 'conn-b' });

    await userEvent.click(select());
    expect(await screen.findByText('Logs C')).toBeInTheDocument();
    expect(screen.queryByText('Logs A')).not.toBeInTheDocument();
  });

  it('flags a connection variable it is waiting on', () => {
    renderFilter(undefined, jest.fn(), { connection: '$conn' }, ['conn']);

    expect(
      screen.getByTestId('dashboard-filter-pending-variable-Logs source'),
    ).toBeInTheDocument();
  });
});
