import { useForm } from 'react-hook-form';
import { screen, within } from '@testing-library/react';

import { AlertPanelLayout } from '@/components/AlertPanel';
import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { TileAlertEditor } from '@/components/DBEditTimeChartForm/TileAlertEditor';
import { DEFAULT_TILE_ALERT } from '@/utils/alerts';

const mockUseConditionEditor = jest.fn();
jest.mock('@/extensions', () => ({
  alertUIExtension: {
    useConditionEditor: (args: unknown) => mockUseConditionEditor(args),
  },
}));

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useAlert: () => ({ data: undefined }),
    useTags: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }),
  },
}));
jest.mock('@/dashboard', () => ({
  __esModule: true,
  useDashboards: () => ({ data: undefined }),
}));
jest.mock('@/components/Alerts', () => ({
  __esModule: true,
  AlertChannelForm: () => null,
}));
jest.mock('@/components/alerts/AlertHistoryCards', () => ({
  __esModule: true,
  AlertHistoryCardList: () => null,
}));
jest.mock('@/components/alerts/AckAlert', () => ({
  __esModule: true,
  AckAlert: () => null,
}));
jest.mock('@/useConfirm', () => ({ useConfirm: () => jest.fn() }));

function Harness() {
  const { control, setValue } = useForm<ChartEditorFormState>({
    defaultValues: { alert: DEFAULT_TILE_ALERT },
  });
  return (
    <AlertPanelLayout defaultOpened>
      <TileAlertEditor
        control={control}
        setValue={setValue}
        alert={DEFAULT_TILE_ALERT}
      />
    </AlertPanelLayout>
  );
}

describe('TileAlertEditor with an alert UI extension', () => {
  beforeEach(() => {
    mockUseConditionEditor.mockReset();
  });

  it('keeps the threshold fields when the extension supplies nothing', () => {
    mockUseConditionEditor.mockReturnValue({});
    renderWithMantine(<Harness />);

    expect(screen.getByText('Trigger when the value')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'is at least (≥)' }),
    ).toBeInTheDocument();
  });

  it('renders the pieces the extension supplies', () => {
    mockUseConditionEditor.mockReturnValue({
      header: <div data-testid="ext-header" />,
      conditionFields: <div data-testid="ext-condition" />,
      conditionLabel: 'Trigger when',
      intervalLabel: 'checked every',
      intervalOptions: { '5m': '5 minutes', '1h': '1 hour' },
      footer: <div data-testid="ext-footer" />,
    });
    renderWithMantine(<Harness />);

    const details = screen.getByTestId('alert-details');
    expect(within(details).getByTestId('ext-header')).toBeInTheDocument();
    expect(within(details).getByTestId('ext-condition')).toBeInTheDocument();
    expect(within(details).getByTestId('ext-footer')).toBeInTheDocument();
    expect(within(details).getByText('Trigger when')).toBeInTheDocument();
    expect(within(details).getByText('checked every')).toBeInTheDocument();
    // The threshold fields are replaced, not shown alongside.
    expect(
      within(details).queryByRole('option', { name: 'is at least (≥)' }),
    ).not.toBeInTheDocument();
    const intervalOptions = within(details)
      .getAllByRole('option')
      .map(o => o.textContent);
    expect(intervalOptions).toEqual(
      expect.arrayContaining(['5 minutes', '1 hour']),
    );
    expect(intervalOptions).not.toContain('1 minute');
  });

  it('passes the form to the extension', () => {
    mockUseConditionEditor.mockReturnValue({});
    renderWithMantine(<Harness />);

    expect(mockUseConditionEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        control: expect.anything(),
        setValue: expect.any(Function),
        alert: DEFAULT_TILE_ALERT,
      }),
    );
  });
});
