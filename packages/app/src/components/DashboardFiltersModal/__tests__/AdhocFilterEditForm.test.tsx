import { useForm } from 'react-hook-form';
import {
  AdhocDashboardFilter,
  DashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { AdhocFilterEditForm } from '@/components/DashboardFiltersModal/AdhocFilterEditForm';
import {
  FilterFormValues,
  toFormValues,
} from '@/components/DashboardFiltersModal/filterFormState';

jest.mock('@/source', () => ({ useSources: () => ({ data: [] }) }));
// The real inputs pull CodeMirror and source metadata into jsdom.
jest.mock('@/components/SearchInput/SearchWhereInput', () => ({
  __esModule: true,
  default: () => null,
  getStoredLanguage: () => undefined,
}));
jest.mock('@/components/SourceMultiSelect', () => ({
  SourceMultiSelectControlled: ({ name }: { name: string }) => (
    <div data-testid={`multi-select-${name}`} />
  ),
}));

const adhoc = (
  overrides: Partial<AdhocDashboardFilter> = {},
): AdhocDashboardFilter => ({
  id: 'a1',
  type: 'ADHOC',
  name: 'Conditions',
  sourceType: 'sql',
  sources: ['logs'],
  isBroadcastEnabled: true,
  isVariableEnabled: true,
  ...overrides,
});

function Harness({
  filter,
  otherFilters,
}: {
  filter: AdhocDashboardFilter;
  otherFilters: DashboardFilter[];
}) {
  const { control, setValue } = useForm<FilterFormValues>({
    defaultValues: toFormValues(filter),
  });
  return (
    <AdhocFilterEditForm
      control={control}
      setValue={setValue}
      otherFilters={otherFilters}
    />
  );
}

const renderForm = (
  filter: AdhocDashboardFilter,
  otherFilters: DashboardFilter[] = [],
) => renderWithMantine(<Harness filter={filter} otherFilters={otherFilters} />);

const warning = () => screen.queryByTestId('adhoc-filter-overlap-warning');

describe('AdhocFilterEditForm', () => {
  it('always shows the broadcast scope, with no broadcast toggle', () => {
    renderForm(adhoc());

    expect(
      screen.getByTestId('multi-select-appliesToSourceIds'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('filter-broadcast-checkbox'),
    ).not.toBeInTheDocument();
  });

  it('says the name is not a referenceable variable', () => {
    renderForm(adhoc());

    expect(screen.getByText('Unique name')).toBeInTheDocument();
    expect(screen.queryByText('Variable name')).not.toBeInTheDocument();
    expect(
      screen.getByText(/can't be referenced as variables/),
    ).toBeInTheDocument();
  });

  it('warns about another ad hoc filter reaching the same source', () => {
    renderForm(adhoc(), [
      adhoc({ id: 'a2', name: 'Other', sources: ['traces'] }),
      adhoc({ id: 'a3', name: 'Logs too', appliesToSourceIds: ['logs'] }),
    ]);

    expect(warning()).toHaveTextContent('Another ad hoc filter (Logs too)');
  });

  it('compares broadcast scopes rather than suggestion sources', () => {
    renderForm(adhoc({ appliesToSourceIds: ['traces'] }), [
      adhoc({ id: 'a2', name: 'Other' }),
    ]);

    expect(warning()).not.toBeInTheDocument();
  });

  it('ignores ad hoc filters of the other source type', () => {
    renderForm(adhoc(), [adhoc({ id: 'a2', sourceType: 'promql' })]);

    expect(warning()).not.toBeInTheDocument();
  });
});
