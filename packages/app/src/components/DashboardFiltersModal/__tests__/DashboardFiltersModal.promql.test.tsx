import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DashboardFiltersModal from '@/components/DashboardFiltersModal';
import { FilterFormControl } from '@/components/DashboardFiltersModal/filterFormState';

jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  IS_PROMQL_ENABLED: true,
}));
// ConfirmProvider pulls in next/router, which jsdom has no answer for.
jest.mock('@/useConfirm', () => ({ useConfirm: () => jest.fn() }));
jest.mock('@/source', () => ({ useSources: () => ({ data: [] }) }));
jest.mock('@/connection', () => ({ useConnections: () => ({ data: [] }) }));

// The real editors would drag CodeMirror and source metadata into jsdom. These
// register the shared source field with the same rules as the real forms.
jest.mock(
  '@/components/DashboardFiltersModal/QueryExpressionFilterEditForm',
  () => ({
    QueryExpressionFilterEditForm: ({
      control,
    }: {
      control: FilterFormControl;
    }) => <input {...control.register('source', { required: true })} />,
  }),
);
jest.mock(
  '@/components/DashboardFiltersModal/PromqlLabelFilterEditForm',
  () => ({
    PromqlLabelFilterEditForm: ({
      control,
    }: {
      control: FilterFormControl;
    }) => (
      <input
        data-testid="promql-source-input"
        {...control.register('source', {
          required: 'Select a PromQL source',
          validate: value => value !== 'logs' || 'Select a PromQL source',
        })}
      />
    ),
  }),
);
jest.mock('@/components/DashboardFiltersModal/SqlQueryFilterEditForm', () => ({
  SqlQueryFilterEditForm: ({ control }: { control: FilterFormControl }) => (
    <div>
      <input
        data-testid="connection-input"
        {...control.register('connection', { required: true })}
      />
      <input data-testid="sql-source-input" {...control.register('source')} />
      <textarea
        data-testid="sql-input"
        {...control.register('sqlTemplate', { required: true })}
      />
    </div>
  ),
}));

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

describe('DashboardFiltersModal with PromQL enabled', () => {
  it.each([
    ['without a source', ''],
    ['with a non-PromQL source', 'logs'],
  ])(
    'saves a SQL query filter %s after visiting the PromQL editor',
    async (_, source) => {
      const onSaveFilter = jest.fn();
      renderWithMantine(
        <DashboardFiltersModal
          opened
          filters={[]}
          showVariableOptions
          showRequiredFilterOptions
          onClose={jest.fn()}
          onSaveFilter={onSaveFilter}
          onRemoveFilter={jest.fn()}
        />,
      );
      const user = userEvent.setup();
      const selectFilterType = async (label: string) => {
        await user.click(screen.getByTestId('filter-type-picker'));
        await user.click(await screen.findByText(label));
      };

      await user.click(screen.getByTestId('add-filter-button'));
      await selectFilterType('PromQL label values');
      expect(screen.getByTestId('promql-source-input')).toBeInTheDocument();
      await selectFilterType('SQL query values');
      await user.type(screen.getByTestId('filter-name-input'), 'Service');
      await user.type(screen.getByTestId('connection-input'), 'conn1');
      if (source) {
        await user.type(screen.getByTestId('sql-source-input'), source);
      }
      await user.type(screen.getByTestId('sql-input'), 'SELECT 1');
      await user.click(screen.getByTestId('save-filter-button'));

      await waitFor(() => expect(onSaveFilter).toHaveBeenCalledTimes(1));
      const saved = onSaveFilter.mock.calls[0][0];
      expect(saved.type).toBe('SQL_QUERY');
      expect(saved.source).toBe(source || undefined);
    },
  );
});
