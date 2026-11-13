import { useForm } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { DataSourceFilterEditForm } from '@/components/DashboardFiltersModal/DataSourceFilterEditForm';
import {
  FilterFormValues,
  toFormValues,
} from '@/components/DashboardFiltersModal/filterFormState';

jest.mock('@/connection', () => ({
  useConnections: () => ({ data: [{ id: 'conn-1', name: 'Primary' }] }),
}));

function Harness({ allowedSourceKinds }: { allowedSourceKinds: SourceKind[] }) {
  const { control } = useForm<FilterFormValues>({
    defaultValues: {
      ...toFormValues(),
      type: 'DATA_SOURCE',
      allowedSourceKinds,
    },
  });
  return <DataSourceFilterEditForm control={control} otherFilters={[]} />;
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
});
