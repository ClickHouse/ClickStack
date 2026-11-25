import { SearchConfigSchema } from '@/DBSearchPage';
import { resolveSearchScope } from '@/searchScope';

jest.mock('@/layout', () => ({
  withAppNav: <T,>(component: T): T => component,
}));

describe('SearchConfigSchema searchScope', () => {
  const base = {
    select: '',
    source: 's',
    where: '',
    whereLanguage: 'lucene' as const,
    orderBy: '',
    filters: [],
  };

  it('defaults searchScope to span when absent', () => {
    // @AC-FR003-02
    const parsed = SearchConfigSchema.parse(base);
    expect(parsed.searchScope).toBe('span');
  });

  it('accepts an explicit trace scope', () => {
    // @AC-FR001-01
    const parsed = SearchConfigSchema.parse({ ...base, searchScope: 'trace' });
    expect(parsed.searchScope).toBe('trace');
  });

  it('rejects an unknown scope', () => {
    // @AC-FR003-02
    expect(() =>
      SearchConfigSchema.parse({ ...base, searchScope: 'session' }),
    ).toThrow();
  });
});

describe('resolveSearchScope', () => {
  it('resolves a missing scope (old URL / saved search) to span', () => {
    // @AC-FR003-02
    expect(resolveSearchScope(undefined)).toBe('span');
    expect(resolveSearchScope(null)).toBe('span');
  });

  it('resolves an unknown value to span', () => {
    // @AC-FR003-02
    expect(resolveSearchScope('nonsense')).toBe('span');
  });

  it('preserves an explicit trace scope', () => {
    // @AC-FR001-01
    expect(resolveSearchScope('trace')).toBe('trace');
  });

  it('preserves an explicit span scope', () => {
    expect(resolveSearchScope('span')).toBe('span');
  });
});
