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

// Runs a pattern filter on one body the way ClickHouse would: strip ANSI
// codes, turn separator runs into single spaces, then match.
function fits(filter: ConditionFilter, body: string): boolean {
  const re2ToJs = (re2: string) =>
    re2
      .replace(/(?<!\\)\\s/g, '\\t\\n\\f\\r ')
      .replace(/\\x\{([0-9A-Fa-f]+)\}/g, '\\u{$1}')
      .replace(/(?<!\\)\\p([A-Z])/g, '\\p{$1}')
      .replaceAll('[:punct:]', '!-\\/:-@\\[-`{-~');
  const [ansi, , separators, , regex] = [
    ...filter.condition.matchAll(/'((?:[^'\\]|\\\\|'')*)'/g),
  ].map(m => m[1].replace(/''/g, "'").replace(/\\\\/g, '\\'));
  const normalized = body
    .replace(RegExp(re2ToJs(ansi), 'gu'), '')
    .replace(RegExp(re2ToJs(separators), 'gu'), ' ');
  const match = RegExp(re2ToJs(regex), 'u').test(normalized);
  return filter.condition.startsWith('NOT ') ? !match : match;
}

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
      /^NOT match\(replaceRegexpAll\(replaceRegexpAll\(Body, /,
    );
    expect(parsePatternFilter(exclude('a <*>'))?.action).toBe('exclude');
    expect(isPatternFilter(facet)).toBe(false);
  });

  it('matches bodies the way the miner saw them', () => {
    const filter = include('info request done');
    expect(fits(filter, 'info: request done')).toBe(true);
    // Color codes, which the miner strips before mining.
    expect(
      fits(filter, '\x1b[32minfo\x1b[39m: request \x1b[1;31mdone\x1b[0m'),
    ).toBe(true);
    // Separators that Python's str.split() has and JS `\s` lacks.
    expect(fits(filter, 'info\x1erequest\x85done')).toBe(true);
    expect(fits(filter, 'warn: request done')).toBe(false);
    expect(
      fits(exclude('info request done'), '\x1b[32minfo\x1b[39m request done'),
    ).toBe(false);
  });

  it('only reads back filters it built', () => {
    // The same predicate without the ANSI step is not a pattern filter.
    const condition = include('a <*>').condition.replace(
      /^match\(replaceRegexpAll\(replaceRegexpAll\(Body, '(?:[^'\\]|\\\\|'')*', ''\)/,
      'match(replaceRegexpAll(Body',
    );
    expect(condition).toMatch(/^match\(replaceRegexpAll\(Body, /);
    expect(isPatternFilter({ type: 'sql', condition })).toBe(false);
  });

  it('reads back a value expression with quotes', () => {
    const expr = "JSONExtractString(Body, 'message')";
    const filter = buildPatternFilter(expr, 'user <*> logged in', 'exclude')!;
    expect(parsePatternFilter(filter)).toMatchObject({
      valueExpression: expr,
      template: 'user <*> logged in',
      action: 'exclude',
    });
  });

  it('builds no filter for a template with punctuation inside a token', () => {
    // The miner splits on punctuation, so its templates never have any.
    expect(buildPatternFilter('Body', "O'Malley C:\\x (a|b)", 'include')).toBe(
      null,
    );
  });

  it('flips a pattern between include and exclude instead of keeping both', () => {
    expect(
      withPatternFilter([facet, include('a <*>')], exclude('a <*>')),
    ).toEqual([facet, exclude('a <*>')]);
    expect(
      withPatternFilter([facet, exclude('a <*>')], include('a <*>')),
    ).toEqual([facet, include('a <*>')]);
  });

  it('replaces an include on another column too', () => {
    const other = buildPatternFilter('Message', 'b <*>', 'include')!;
    expect(withPatternFilter([include('a <*>')], other)).toEqual([other]);
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
