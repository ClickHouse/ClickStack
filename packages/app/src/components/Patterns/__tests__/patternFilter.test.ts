import type { ConditionFilter, Filter } from '@hyperdx/common-utils/dist/types';

import {
  buildPatternFilter,
  isPatternFilter,
  parsePatternFilter,
  withPatternFilter,
} from '@/components/Patterns/patternFilter';

const include = (template: string): ConditionFilter =>
  buildPatternFilter('Body', template, 'include')!;
const exclude = (template: string): ConditionFilter =>
  buildPatternFilter('Body', template, 'exclude')!;
const facet: Filter = { type: 'sql', condition: "ServiceName IN ('cart')" };

describe('pattern filters', () => {
  it('builds include and exclude filters that read back', () => {
    expect(
      parsePatternFilter(include('GetCartAsync called with userId <*>')),
    ).toMatchObject({
      valueExpression: 'Body',
      template: 'GetCartAsync called with userId <*>',
      action: 'include',
    });
    expect(exclude('a <*>').condition).toMatch(
      /^NOT match\(replaceRegexpAll\(Body, /,
    );
    expect(parsePatternFilter(exclude('a <*>'))?.action).toBe('exclude');
    expect(isPatternFilter(facet)).toBe(false);
  });

  it('flips a pattern between include and exclude instead of keeping both', () => {
    expect(
      withPatternFilter([facet, include('a <*>')], exclude('a <*>')),
    ).toEqual([facet, exclude('a <*>')]);
  });

  it('keeps one include and stacks excludes', () => {
    let filters: Filter[] = [facet];
    filters = withPatternFilter(filters, exclude('a <*>'));
    filters = withPatternFilter(filters, exclude('b <*>'));
    filters = withPatternFilter(filters, include('c <*>'));
    filters = withPatternFilter(filters, include('d <*>'));
    expect(filters).toEqual([
      facet,
      exclude('a <*>'),
      exclude('b <*>'),
      include('d <*>'),
    ]);
  });
});
