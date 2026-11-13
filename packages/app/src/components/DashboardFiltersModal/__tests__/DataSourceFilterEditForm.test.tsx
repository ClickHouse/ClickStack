import { useForm } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DataSourceFilterEditForm } from '@/components/DashboardFiltersModal/DataSourceFilterEditForm';
import {
  FilterFormValues,
  toFormValues,
  toSavedFilter,
} from '@/components/DashboardFiltersModal/filterFormState';

jest.mock('@/connection', () => ({
  useConnections: () => ({ data: [{ id: 'conn-1', name: 'Primary' }] }),
}));

function Harness({
  allowedSourceKinds,
  connection,
  onSave,
}: {
  allowedSourceKinds: SourceKind[];
  connection?: string;
  onSave?: (values: FilterFormValues) => void;
}) {
  const { control, getValues } = useForm<FilterFormValues>({
    defaultValues: {
      ...toFormValues(),
      type: 'DATA_SOURCE',
      name: 'Logs source',
      allowedSourceKinds,
      connection,
    },
  });
  return (
    <>
      <DataSourceFilterEditForm control={control} otherFilters={[]} />
      <button type="button" onClick={() => onSave?.(getValues())}>
        Save
      </button>
    </>
  );
}

const warning = () => screen.queryByTestId('filter-mixed-source-kinds-warning');

describe('DataSourceFilterEditForm', () => {
  it('warns when the kinds support different chart options', () => {
    renderWithMantine(
      <Harness allowedSourceKinds={[SourceKind.Log, SourceKind.Metric]} />,
    );
    expect(warning()).toBeInTheDocument();
  });

  it('does not warn for kinds that charts treat alike', () => {
    renderWithMantine(
      <Harness allowedSourceKinds={[SourceKind.Log, SourceKind.Trace]} />,
    );
    expect(warning()).not.toBeInTheDocument();
  });

  it('saves no connection once the connection is cleared', async () => {
    const onSave = jest.fn();
    renderWithMantine(
      <Harness
        allowedSourceKinds={[SourceKind.Log]}
        connection="conn-1"
        onSave={onSave}
      />,
    );

    const input = screen.getByTestId('filter-data-source-connection-input');
    expect(input).toHaveValue('Primary');
    const clearButton = input.parentElement?.querySelector('button');
    if (!clearButton) throw new Error('Expected a clear button');
    await userEvent.click(clearButton);
    expect(input).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(toSavedFilter(onSave.mock.calls[0][0])).toMatchObject({
      connection: undefined,
    });
  });
});
