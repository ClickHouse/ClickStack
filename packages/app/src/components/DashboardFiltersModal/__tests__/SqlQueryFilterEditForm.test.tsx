import { useForm } from 'react-hook-form';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  FilterFormControl,
  FilterFormValues,
  toFormValues,
} from '@/components/DashboardFiltersModal/filterFormState';
import { SqlQueryFilterEditForm } from '@/components/DashboardFiltersModal/SqlQueryFilterEditForm';

const mockUseSqlQueryFilterValues = jest.fn();
const mockCompletionLabels: string[] = [];

jest.mock('@/hooks/useSqlQueryFilterValues', () => ({
  useSqlQueryFilterValues: (...args: unknown[]) =>
    mockUseSqlQueryFilterValues(...args),
}));
// The real selector fetches connections, and the real editor is CodeMirror;
// plain inputs bound to the same fields are enough to drive the preview.
jest.mock('@/components/ConnectionSelect', () => ({
  ConnectionSelectControlled: ({
    control,
    name,
  }: {
    control: FilterFormControl;
    name: 'connection';
  }) => <input data-testid="connection-input" {...control.register(name)} />,
}));
jest.mock('@/components/SQLEditor/SQLEditor', () => ({
  SQLEditorControlled: ({
    control,
    name,
    additionalCompletions,
  }: {
    control: FilterFormControl;
    name: 'sqlTemplate';
    additionalCompletions?: { label: string }[];
  }) => {
    mockCompletionLabels.splice(
      0,
      mockCompletionLabels.length,
      ...(additionalCompletions ?? []).map(c => c.label),
    );
    return <textarea data-testid="sql-input" {...control.register(name)} />;
  },
}));

const valuesResult = ({
  values = [],
  error,
}: {
  values?: string[];
  error?: string;
}) => ({
  data: new Map([['preview', { values, isLoading: false }]]),
  filterErrorMessages: new Map(error ? [['preview', error]] : []),
  isLoading: false,
  isError: !!error,
});

function Harness() {
  const { control } = useForm<FilterFormValues>({
    defaultValues: { ...toFormValues(), type: 'SQL_QUERY' },
  });
  return <SqlQueryFilterEditForm control={control} otherFilters={[]} />;
}

const renderForm = async () => {
  renderWithMantine(<Harness />);
  const user = userEvent.setup();
  await user.type(screen.getByTestId('connection-input'), 'conn1');
  await user.type(screen.getByTestId('sql-input'), 'SELECT env FROM envs');
  return user;
};

describe('SqlQueryFilterEditForm', () => {
  beforeEach(() => {
    mockUseSqlQueryFilterValues.mockReset();
    mockUseSqlQueryFilterValues.mockReturnValue(
      valuesResult({ values: ['prod', 'dev'] }),
    );
  });

  it('suggests time macros but not macros that need a source', () => {
    renderWithMantine(<Harness />);

    expect(mockCompletionLabels).toContain('$__timeFilter');
    expect(
      mockCompletionLabels.filter(label =>
        /^\$__(sourceTable|filters)(\(|$)/.test(label),
      ),
    ).toEqual([]);
  });

  it('disables the preview until there is a connection and a query', async () => {
    renderWithMantine(<Harness />);

    expect(screen.getByTestId('filter-sql-preview-button')).toBeDisabled();
  });

  it('previews the values the query returns', async () => {
    const user = await renderForm();

    expect(screen.queryByTestId('filter-sql-preview')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('filter-sql-preview-button'));

    expect(screen.getByTestId('filter-sql-preview')).toHaveTextContent(
      '2 values',
    );
    expect(screen.getByTestId('filter-sql-preview-values')).toHaveTextContent(
      /^prod, dev$/,
    );
    expect(mockUseSqlQueryFilterValues).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            connection: 'conn1',
            sqlTemplate: 'SELECT env FROM envs',
          }),
        ],
      }),
    );
  });

  it('lists the first twenty values and counts the rest', async () => {
    mockUseSqlQueryFilterValues.mockReturnValue(
      valuesResult({ values: Array.from({ length: 25 }, (_, i) => `v${i}`) }),
    );
    const user = await renderForm();

    await user.click(screen.getByTestId('filter-sql-preview-button'));

    const list = screen.getByTestId('filter-sql-preview-values');
    expect(list).toHaveTextContent(/^v0, v1, .*, v19, and 5 more$/);
    expect(list).not.toHaveTextContent('v20');
  });

  it('truncates a long value and keeps it whole in its title', async () => {
    const long = 'eu-west-1-production-blue';
    mockUseSqlQueryFilterValues.mockReturnValue(
      valuesResult({ values: [long, 'exactly-twenty-chars'] }),
    );
    const user = await renderForm();

    await user.click(screen.getByTestId('filter-sql-preview-button'));

    expect(screen.getByTestId('filter-sql-preview-values')).toHaveTextContent(
      'eu-west-1-production…, exactly-twenty-chars',
    );
    expect(screen.getByTitle(long)).toBeInTheDocument();
  });

  it("shows the query's error", async () => {
    mockUseSqlQueryFilterValues.mockReturnValue(
      valuesResult({ error: 'Unknown table default.envs' }),
    );
    const user = await renderForm();

    await user.click(screen.getByTestId('filter-sql-preview-button'));

    expect(screen.getByTestId('filter-sql-preview')).toHaveTextContent(
      'Unknown table default.envs',
    );
  });
});
