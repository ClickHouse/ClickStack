import { DashboardFilter, SourceKind } from '@hyperdx/common-utils/dist/types';
import { fromPartial } from '@total-typescript/shoehorn';

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

const sqlQuery = (
  overrides: Partial<Extract<DashboardFilter, { type: 'SQL_QUERY' }>> = {},
): DashboardFilter => ({
  id: 's1',
  type: 'SQL_QUERY',
  name: 'Hosts',
  connection: 'conn1',
  source: 'logs',
  sqlTemplate: 'SELECT 1',
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  ...overrides,
});

const sql = [SourceKind.Log, SourceKind.Trace, SourceKind.Session];
const sqlQueryKinds = [
  SourceKind.Log,
  SourceKind.Trace,
  SourceKind.Session,
  SourceKind.Metric,
];

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

  it("returns a SQL query filter's source with its connection", () => {
    expect(getChangedFilterSourceRefs([sqlQuery()])).toEqual([
      { id: 'logs', kinds: sqlQueryKinds, connection: 'conn1' },
    ]);
  });

  it('does not pin a SQL query source to a connection variable', () => {
    expect(
      getChangedFilterSourceRefs([sqlQuery({ connection: '$conn' })]),
    ).toEqual([{ id: 'logs', kinds: sqlQueryKinds }]);
  });

  it('re-checks a SQL query source whose connection changed', () => {
    expect(
      getChangedFilterSourceRefs(
        [sqlQuery({ connection: 'conn2' })],
        [sqlQuery()],
      ),
    ).toEqual([{ id: 'logs', kinds: sqlQueryKinds, connection: 'conn2' }]);
  });

  it('checks a filter without an ID, or with a new one', () => {
    const { id: _id, ...withoutId } = adhoc();
    expect(
      getChangedFilterSourceRefs(
        [fromPartial(withoutId), adhoc({ id: 'new' })],
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
    { _id: 'logs', kind: SourceKind.Log, connection: 'conn1' },
    { _id: 'prom', kind: SourceKind.Promql, connection: 'conn1' },
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

  it('names sources not on the connection the filter requires', () => {
    expect(
      getFilterSourceRefError(
        [
          { id: 'logs', kinds: sql, connection: 'conn1' },
          { id: 'logs', kinds: sql, connection: 'conn2' },
        ],
        sources,
      ),
    ).toBe(
      "The following filter source IDs are not on the filter's connection: logs",
    );
  });
});
