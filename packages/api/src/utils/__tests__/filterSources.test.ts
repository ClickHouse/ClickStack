import { DashboardFilter, SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  getChangedFilterSourceRefs,
  getFilterSourceRefError,
} from '@/utils/filterSources';

const adhoc = (
  overrides: Partial<Extract<DashboardFilter, { type: 'ADHOC' }>> = {},
): DashboardFilter => ({
  id: 'a1',
  type: 'ADHOC',
  name: 'Conditions',
  sourceType: 'sql',
  sources: ['logs'],
  isBroadcastEnabled: true,
  isVariableEnabled: true,
  ...overrides,
});

const label: DashboardFilter = {
  id: 'l1',
  type: 'PROMETHEUS_LABEL',
  name: 'Job',
  source: 'prom',
  label: 'job',
  isBroadcastEnabled: false,
  isVariableEnabled: true,
};

const sql = [SourceKind.Log, SourceKind.Trace, SourceKind.Session];

describe('getChangedFilterSourceRefs', () => {
  it('returns every reference without stored filters', () => {
    expect(
      getChangedFilterSourceRefs([
        adhoc({ appliesToSourceIds: ['traces'] }),
        label,
      ]),
    ).toEqual([
      { id: 'logs', kinds: sql },
      { id: 'traces', kinds: sql },
      { id: 'prom', kinds: [SourceKind.Promql] },
    ]);
  });

  it('skips references the stored filter with the same ID already made', () => {
    expect(
      getChangedFilterSourceRefs(
        [adhoc({ sources: ['logs', 'traces'] }), label],
        [adhoc(), label],
      ),
    ).toEqual([{ id: 'traces', kinds: sql }]);
  });

  it('re-checks a reference whose required kinds changed', () => {
    expect(
      getChangedFilterSourceRefs([adhoc({ sourceType: 'promql' })], [adhoc()]),
    ).toEqual([{ id: 'logs', kinds: [SourceKind.Promql] }]);
  });

  it('checks a filter without an ID, or with a new one', () => {
    const { id: _id, ...withoutId } = adhoc();
    expect(
      getChangedFilterSourceRefs(
        [withoutId as DashboardFilter, adhoc({ id: 'new' })],
        [adhoc()],
      ),
    ).toEqual([
      { id: 'logs', kinds: sql },
      { id: 'logs', kinds: sql },
    ]);
  });
});

describe('getFilterSourceRefError', () => {
  const sources = [
    { _id: 'logs', kind: SourceKind.Log },
    { _id: 'prom', kind: SourceKind.Promql },
  ];

  it('accepts references to existing sources of the right kind', () => {
    expect(
      getFilterSourceRefError(
        [
          { id: 'logs', kinds: sql },
          { id: 'prom', kinds: [SourceKind.Promql] },
        ],
        sources,
      ),
    ).toBeNull();
  });

  it('names missing sources and sources of the wrong kind once each', () => {
    expect(
      getFilterSourceRefError(
        [
          { id: 'prom', kinds: sql },
          { id: 'gone', kinds: sql },
          { id: 'gone', kinds: sql },
        ],
        sources,
      ),
    ).toBe(
      'The following filter source IDs do not exist or are not a kind of source the filter supports: prom, gone',
    );
  });
});
