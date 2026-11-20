import { getReferencedWithClauses } from '@/components/Search/histogramWith';

const clause = (name: string, sql: string) => ({
  name,
  sql: { sql, params: {} },
  isSubquery: false,
});

describe('getReferencedWithClauses', () => {
  const withClauses = [
    clause('service', 'ServiceName'),
    clause('body', 'toString(Body)'),
    clause('shout', 'upper(body)'),
  ];

  it('returns undefined when nothing is referenced', () => {
    expect(
      getReferencedWithClauses(withClauses, ['level:error', '[]']),
    ).toBeUndefined();
  });

  it('keeps clauses referenced by the where, filters or group by', () => {
    expect(
      getReferencedWithClauses(withClauses, ["service = 'api'", '[]', ''])?.map(
        c => c.name,
      ),
    ).toEqual(['service']);
  });

  it('keeps aliases that a referenced alias depends on', () => {
    expect(
      getReferencedWithClauses(withClauses, ['shout:ERROR'])?.map(c => c.name),
    ).toEqual(['body', 'shout']);
  });

  it('handles missing clauses', () => {
    expect(getReferencedWithClauses(undefined, ['service'])).toBeUndefined();
  });
});
