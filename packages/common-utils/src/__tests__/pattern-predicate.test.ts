import { TemplateMinerConfig } from '@/drain/config';
import {
  buildCompactPatternPredicate,
  buildPatternPredicate,
  MAX_PREDICATE_TEMPLATE_LENGTH,
  parsePatternPredicate,
  PatternRegexOptions,
  templateToRegex,
} from '@/drain/pattern-predicate';
import { TemplateMiner } from '@/drain/template-miner';

// Python's string.punctuation, the extra delimiters the app's miner uses.
const PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split('');
const withPunctuation = { extraDelimiters: PUNCTUATION };

// RE2 spells code points \x{HHHH} and categories \pZ; JS (with the u flag)
// spells them \u{HHHH} and \p{Z}, and has no POSIX classes. RE2's \s is
// [\t\n\f\r ]; JS's also covers Unicode spaces and BOM.
function toJsSource(re2: string): string {
  return re2
    .replace(/(?<!\\)\\s/g, '\\t\\n\\f\\r ')
    .replace(/\\x\{([0-9A-Fa-f]+)\}/g, '\\u{$1}')
    .replace(/(?<!\\)\\p([A-Z])/g, '\\p{$1}')
    .replaceAll('[:punct:]', '!-\\/:-@\\[-`{-~');
}

function toJsRegex(re2: string): RegExp {
  return RegExp(toJsSource(re2), 'u');
}

const unescapeSql = (literal: string) =>
  literal.replace(/''/g, "'").replace(/\\\\/g, '\\');

// Evaluates a compact predicate the way ClickHouse would: replaceRegexpAll,
// then match.
function matchesCompact(predicate: string, value: string): boolean {
  const call =
    /^match\(replaceRegexpAll\(.+, '((?:[^'\\]|\\\\|'')*)', ' '\), '((?:[^'\\]|\\\\|'')*)'\)$/s.exec(
      predicate,
    );
  if (call == null) throw new Error(`not a compact predicate: ${predicate}`);
  const separatorRun = RegExp(toJsSource(unescapeSql(call[1])), 'gu');
  return toJsRegex(unescapeSql(call[2])).test(value.replace(separatorRun, ' '));
}

const MESSAGES = [
  'Connection to db-1:5432 timed out after 30s (retry 1/3)',
  'Connection to db-2:5432 timed out after 30s (retry 2/3)',
  'user=alice action=login status=ok',
  'user=bob action=login status=ok',
  '[2026-04-17T08:35:57.725Z] "GET /api/products/2ZYF HTTP/1.1" 200 -',
  '[2026-04-17T08:36:02.101Z] "GET /api/products/L9EC HTTP/1.1" 200 -',
  'path=C:\\temp\\a.txt mode=[r^w] note={a|b} cost=$5 ~ok',
  'path=C:\\temp\\b.txt mode=[r^w] note={a|b} cost=$7 ~ok',
];

function mineClusters(): { template: string; members: string[] }[] {
  const config = new TemplateMinerConfig();
  config.drainExtraDelimiters = PUNCTUATION;
  const miner = new TemplateMiner(config);
  const members = new Map<number, string[]>();
  for (const message of MESSAGES) {
    const { clusterId } = miner.addLogMessage(message);
    members.set(clusterId, [...(members.get(clusterId) ?? []), message]);
  }
  return [...members].map(([clusterId, clusterMembers]) => ({
    template: miner.drain.getCluster(clusterId)!.getTemplate(),
    members: clusterMembers,
  }));
}

describe('templateToRegex', () => {
  it('splits on whitespace only without extra delimiters', () => {
    const ws = '[\\s\\x{0B}\\pZ\\x{FEFF}]';
    expect(templateToRegex('Sending <*> rows')).toBe(
      `^${ws}*Sending${ws}+[^\\s\\x{0B}\\pZ\\x{FEFF}]+${ws}+rows${ws}*$`,
    );
  });

  it('spells all ASCII punctuation as [:punct:] and lists other delimiters', () => {
    expect(templateToRegex('a', withPunctuation)).toBe(
      '^[\\s\\x{0B}\\pZ\\x{FEFF}[:punct:]]*a[\\s\\x{0B}\\pZ\\x{FEFF}[:punct:]]*$',
    );
    const partial = { extraDelimiters: ['/', ':', '-', ']', '\\', '^'] };
    const regex = toJsRegex(templateToRegex('a <*> c d e f g', partial));
    expect(regex.test('a/x:c-d]e\\f^g')).toBe(true);
    expect(regex.test('a/x:c-d]e\\f^g.h')).toBe(false);
  });

  it('splits on Python whitespace for templates mined by Drain3', () => {
    const python: PatternRegexOptions = {
      extraDelimiters: PUNCTUATION,
      whitespace: 'python',
    };
    // Python's str.split() splits on the \x1C-\x1F separators and NEL but not
    // on BOM; JS `\s` is the other way round.
    const drain3 = toJsRegex(templateToRegex('a b c', python));
    expect(drain3.test('a\x1eb\x85c')).toBe(true);
    expect(drain3.test('a\ufeffb c')).toBe(false);
    const ts = toJsRegex(templateToRegex('a b c', withPunctuation));
    expect(ts.test('a\x1eb\x85c')).toBe(false);
    expect(ts.test('a\ufeffb c')).toBe(true);

    const predicate = buildPatternPredicate('Body', 'a b c', python)!;
    expect(parsePatternPredicate(predicate, python)?.template).toBe('a b c');
    expect(parsePatternPredicate(predicate, withPunctuation)).toBeNull();
  });

  it('rejects delimiters longer than one character', () => {
    expect(() => templateToRegex('a', { extraDelimiters: ['::'] })).toThrow(
      'single characters',
    );
  });

  it('treats extra delimiters as separators', () => {
    const regex = toJsRegex(
      templateToRegex('GET api v1 users <*> <*> <*>', withPunctuation),
    );
    expect(regex.test('GET /api/v1/users/123 200 15ms')).toBe(true);
    expect(regex.test('GET /api/v1/users/9 404 3ms')).toBe(true);
    expect(regex.test('  GET /api/v1/users/9 404 3ms.')).toBe(true);

    expect(regex.test('POST /api/v1/users/9 404 3ms')).toBe(false);
    expect(regex.test('GET /api/v1/users/9/orders 404 3ms')).toBe(false);
    expect(regex.test('GET /api/v1/users/9 404')).toBe(false);
    expect(regex.test('GET /api/v2/users/9 404 3ms')).toBe(false);
  });

  it('matches every member of every cluster mined with the same delimiters', () => {
    for (const { template, members } of mineClusters()) {
      const regex = toJsRegex(templateToRegex(template, withPunctuation));
      for (const message of MESSAGES) {
        expect(regex.test(message)).toBe(members.includes(message));
      }
    }
  });
});

// The option sets the equivalence and round-trip tests run under.
const OPTION_SETS: (PatternRegexOptions | undefined)[] = [
  withPunctuation,
  undefined,
  { extraDelimiters: ['/', ':', '-', ']', '\\', '^'] },
  { extraDelimiters: PUNCTUATION, whitespace: 'python' },
];

describe('buildCompactPatternPredicate', () => {
  it('matches exactly what the full predicate matches', () => {
    const values = [
      ...MESSAGES,
      '  GET /api/v1/users/9 404 3ms.',
      '',
      ' \t ',
      'GET api v1 users 9 404',
      // Separators outside ASCII, and ones only one whitespace set has.
      'GET\u00a0api\u2003v1\x0busers\u3000 9 404 3ms',
      'GET api\ufeffv1 users 9 404 3ms',
      'GET api v1 users 9\x1e404\x853ms',
    ];
    const templates = [
      ...mineClusters().map(c => c.template),
      'GET api v1 users <*> <*> <*>',
      '<*>',
      '',
    ];
    for (const options of OPTION_SETS) {
      for (const template of templates) {
        const full = toJsRegex(templateToRegex(template, options));
        const compact = buildCompactPatternPredicate(
          'Body',
          template,
          options,
        )!;
        for (const value of values) {
          expect([template, value, matchesCompact(compact, value)]).toEqual([
            template,
            value,
            full.test(value),
          ]);
        }
      }
    }
  });

  it('is much shorter than the full predicate for long templates', () => {
    const template = Array.from({ length: 40 }, (_, i) =>
      i % 3 === 0 ? '<*>' : `word${i}`,
    ).join(' ');
    const full = buildPatternPredicate('Body', template, withPunctuation)!;
    const compact = buildCompactPatternPredicate(
      'Body',
      template,
      withPunctuation,
    )!;
    expect(compact.length * 4).toBeLessThan(full.length);
  });
});

describe('buildPatternPredicate', () => {
  it('builds no predicate for a template over the length limit', () => {
    const atLimit = 'x'.repeat(MAX_PREDICATE_TEMPLATE_LENGTH);
    expect(buildPatternPredicate('Body', atLimit)).not.toBeNull();
    expect(buildPatternPredicate('Body', `${atLimit}x`)).toBeNull();
  });
});

describe('parsePatternPredicate', () => {
  it.each([
    ['Body', 'GET api v1 users <*> <*> <*>'],
    ["JSONExtractString(Body, 'message')", 'user <*> action login status ok'],
    ['Body', '<*>'],
  ])('reads back what either builder built (%s)', (expr, template) => {
    for (const options of OPTION_SETS) {
      for (const build of [
        buildPatternPredicate,
        buildCompactPatternPredicate,
      ]) {
        const predicate = build(expr, template, options)!;
        expect(parsePatternPredicate(predicate, options)).toEqual({
          valueExpression: expr,
          template,
        });
      }
    }
  });

  it('reads back what buildPatternPredicate built without options', () => {
    const predicate = buildPatternPredicate('Body', 'Sending <*> rows')!;
    expect(parsePatternPredicate(predicate)).toEqual({
      valueExpression: 'Body',
      template: 'Sending <*> rows',
    });
  });

  it('rejects other conditions', () => {
    expect(parsePatternPredicate("ServiceName IN ('api')")).toBeNull();
    expect(parsePatternPredicate("match(Body, 'timed out')")).toBeNull();
    // A predicate only reads back with the options it was built with.
    expect(
      parsePatternPredicate(
        "match(replaceRegexpAll(Body, '[ ]+', ' '), '^ ?timed out ?$')",
        withPunctuation,
      ),
    ).toBeNull();
    // The real separator class with a hand-written regex: only the round trip
    // through compactRegex rejects it.
    const compact = buildCompactPatternPredicate(
      'Body',
      'timed out',
      withPunctuation,
    )!;
    const handWritten = compact.replace(
      "'^ ?timed out ?$'",
      "'^ ?timed.* out ?$'",
    );
    expect(handWritten).not.toBe(compact);
    expect(parsePatternPredicate(handWritten, withPunctuation)).toBeNull();
    expect(
      parsePatternPredicate(
        buildPatternPredicate('Body', 'Sending <*> rows')!,
        withPunctuation,
      ),
    ).toBeNull();
    expect(
      parsePatternPredicate(
        buildPatternPredicate('Body', 'Sending <*> rows', withPunctuation)!,
      ),
    ).toBeNull();
  });
});
