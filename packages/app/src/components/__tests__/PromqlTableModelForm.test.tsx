import { useForm, useWatch } from 'react-hook-form';
import {
  PromqlSourceBackend,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PromqlTableModelForm } from '@/components/Sources/SourceForm/PromqlTableModelForm';

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

function Harness({
  promqlBackend,
  isPrometheusEndpoint,
}: {
  promqlBackend?: PromqlSourceBackend;
  isPrometheusEndpoint?: boolean;
}) {
  const { control, setValue } = useForm<TSource>({
    defaultValues: {
      kind: SourceKind.Promql,
      name: 'PromQL',
      connection: 'conn-1',
      from: { databaseName: 'default', tableName: 'metrics_ts' },
      timestampValueExpression: 'timestamp',
      promqlBackend,
    },
  });
  const backend = useWatch({ control, name: 'promqlBackend' });
  return (
    <>
      <PromqlTableModelForm
        control={control}
        setValue={setValue}
        isPrometheusEndpoint={isPrometheusEndpoint}
      />
      <div data-testid="backend-value">{backend ?? 'unset'}</div>
    </>
  );
}

const backendSelect = () => screen.getByTestId('promql-backend-select');

describe('PromqlTableModelForm', () => {
  it('shows Auto for a source that has no backend set', () => {
    renderWithMantine(<Harness />);

    expect(backendSelect()).toHaveAttribute(
      'placeholder',
      'Auto (detect from server)',
    );
    expect(backendSelect()).toHaveValue('');
    expect(screen.getByTestId('backend-value')).toHaveTextContent('unset');
  });

  it('shows the backend a source has set', () => {
    renderWithMantine(<Harness promqlBackend="clickhouse-http" />);

    expect(backendSelect()).toHaveValue('Prometheus HTTP API');
  });

  it('sets the backend from the option picked', async () => {
    const user = userEvent.setup();
    renderWithMantine(<Harness />);

    await user.click(backendSelect());
    await user.click(await screen.findByText('Table functions'));

    expect(screen.getByTestId('backend-value')).toHaveTextContent(
      'table-function',
    );
  });

  it('can go back to Auto after another backend was picked', async () => {
    const user = userEvent.setup();
    renderWithMantine(<Harness promqlBackend="table-function" />);

    await user.click(backendSelect());
    await user.click(await screen.findByText('Auto (detect from server)'));

    expect(screen.getByTestId('backend-value')).toHaveTextContent('auto');
  });

  it('hides the backend for a Prometheus endpoint, which is always queried through its own API', () => {
    renderWithMantine(<Harness isPrometheusEndpoint />);

    expect(screen.queryByTestId('promql-backend-select')).toBeNull();
    expect(screen.queryByText('PromQL backend')).toBeNull();
    // The rest of the form is unaffected.
    expect(screen.getByText('Minimum auto granularity')).toBeInTheDocument();
  });
});
