import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import { fromPartial } from '@total-typescript/shoehorn';

import { SourcesList } from '@/components/Sources/SourcesList';
import { useConnections } from '@/connection';
import { useSources } from '@/source';

jest.mock('next/router', () => ({
  useRouter: () => ({ push: jest.fn(), query: {}, pathname: '/' }),
}));
jest.mock('@/source', () => ({ useSources: jest.fn() }));
jest.mock('@/connection', () => ({ useConnections: jest.fn() }));
jest.mock('@/config', () => ({ IS_LOCAL_MODE: false }));
// TableSourceForm only renders while editing/creating; stub it so the list test
// does not pull in the full source form.
jest.mock('../Sources/SourceForm', () => ({ TableSourceForm: () => null }));

const makeSource = (
  id: string,
  name: string,
  overrides: Partial<TSource> = {},
): TSource =>
  fromPartial({
    id,
    name,
    kind: SourceKind.Log,
    connection: 'conn-a',
    ...overrides,
  });

describe('SourcesList section display', () => {
  beforeEach(() => {
    jest.mocked(useConnections).mockReturnValue(
      fromPartial({
        data: [{ id: 'conn-a', name: 'Default' }],
        isLoading: false,
        refetch: jest.fn(),
      }),
    );
  });

  it('shows the section on a sectioned source and nothing on an unsectioned one', () => {
    jest.mocked(useSources).mockReturnValue(
      fromPartial({
        data: [
          makeSource('a', 'Billing Logs', { section: 'Billing' }),
          makeSource('b', 'Plain Source'),
        ],
        isLoading: false,
        refetch: jest.fn(),
      }),
    );
    renderWithMantine(<SourcesList withCard={false} />);

    expect(screen.getByText('Billing Logs')).toBeInTheDocument();
    expect(screen.getByText('Plain Source')).toBeInTheDocument();
    // The section label renders only for the source that has one.
    expect(screen.getAllByText('Billing')).toHaveLength(1);
  });

  it('shows no section labels when no source has a section', () => {
    jest.mocked(useSources).mockReturnValue(
      fromPartial({
        data: [makeSource('a', 'App'), makeSource('b', 'Host')],
        isLoading: false,
        refetch: jest.fn(),
      }),
    );
    renderWithMantine(<SourcesList withCard={false} />);

    expect(screen.getByText('App')).toBeInTheDocument();
    expect(screen.getByText('Host')).toBeInTheDocument();
  });

  it('shows the plural kind label for each source', () => {
    jest.mocked(useSources).mockReturnValue(
      fromPartial({
        data: [
          makeSource('a', 'A'),
          makeSource('b', 'B', { kind: SourceKind.Trace }),
          makeSource('c', 'C', { kind: SourceKind.Metric }),
          makeSource('d', 'D', { kind: SourceKind.Session }),
          makeSource('e', 'E', { kind: SourceKind.Promql }),
        ],
        isLoading: false,
        refetch: jest.fn(),
      }),
    );
    renderWithMantine(<SourcesList withCard={false} />);

    for (const label of [
      'Logs',
      'Traces',
      'OTel metrics',
      'Sessions',
      'Time Series',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('names a PromQL source after the connection it reads from', () => {
    jest.mocked(useConnections).mockReturnValue(
      fromPartial({
        data: [
          { id: 'conn-a', name: 'Default' },
          { id: 'conn-prom', name: 'Thanos', isPrometheusEndpoint: true },
        ],
        isLoading: false,
        refetch: jest.fn(),
      }),
    );
    jest.mocked(useSources).mockReturnValue(
      fromPartial({
        data: [
          makeSource('a', 'A', { kind: SourceKind.Promql }),
          makeSource('b', 'B', {
            kind: SourceKind.Promql,
            connection: 'conn-prom',
          }),
          makeSource('c', 'C', {
            kind: SourceKind.Promql,
            connection: 'conn-missing',
          }),
        ],
        isLoading: false,
        refetch: jest.fn(),
      }),
    );
    renderWithMantine(<SourcesList withCard={false} />);

    expect(screen.getByText('Time Series')).toBeInTheDocument();
    expect(screen.getByText('Prometheus')).toBeInTheDocument();
    expect(screen.getByText('Time Series / Prometheus')).toBeInTheDocument();
  });
});
