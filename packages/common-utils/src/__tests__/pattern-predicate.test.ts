import { DATE_MASK, TemplateMinerConfig } from '@/drain/config';
import { minePatterns, PATTERN_REGEX_OPTIONS } from '@/drain/mine-patterns';
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
const withDates = { masks: [DATE_MASK] };

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
  // Like the app's drain3 miner, which applies no masks.
  config.maskingInstructions = [];
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
    // So a Drain3 token can hold a BOM, as in a body that starts with one.
    const bomTemplate = '\ufeffGET api <*>';
    expect(
      toJsRegex(templateToRegex(bomTemplate, python)).test('\ufeffGET /api/x'),
    ).toBe(true);
    expect(
      parsePatternPredicate(
        buildPatternPredicate('Body', bomTemplate, python)!,
        python,
      )?.template,
    ).toBe(bomTemplate);

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

const PARTIAL: PatternRegexOptions = {
  extraDelimiters: ['/', ':', '-', ']', '\\', '^'],
};

// The option sets the equivalence and round-trip tests run under.
const OPTION_SETS: (PatternRegexOptions | undefined)[] = [
  withPunctuation,
  undefined,
  PARTIAL,
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

  it('honors masks like the full predicate', () => {
    const values = [
      'wrote backup_2026-11-04.tar',
      'wrote  backup_2026-11-04.tar ',
      'wrote backup_.tar',
      'wrote backup_<DATE>.tar',
      'I1104 06:12:12.345678 sync done',
    ];
    for (const options of [withDates, undefined]) {
      for (const template of [
        'wrote backup_<DATE>.tar',
        'I<DATE> <*> sync done',
      ]) {
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
    expect(
      matchesCompact(
        buildCompactPatternPredicate(
          'Body',
          'wrote backup_<DATE>.tar',
          withDates,
        )!,
        'wrote backup_2026-11-04.tar',
      ),
    ).toBe(true);
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

  it('escapes regex and SQL syntax in tokens', () => {
    // Mined without punctuation delimiters, tokens keep their punctuation.
    const cases: [PatternRegexOptions | undefined, string][] = [
      [undefined, 'GET /api/v1.2 (ok) $5 a|b'],
      [undefined, "user=<*> it's C:\\tmp 3ms."],
      [PARTIAL, 'GET api v1.2 (ok) $5 a|b'],
    ];
    const values = [
      'GET /api/v1.2 (ok) $5 a|b',
      'GET /api/v1x2 (ok) $5 a|b',
      'GET api v1.2 (ok) $5 a|b',
      'GET/api/v1.2 (ok) $5 a|b',
      "user=<*> it's C:\\tmp 3ms.",
      "user=<*> it's C:\\tmp 3msX",
    ];
    for (const [options, template] of cases) {
      const full = toJsRegex(templateToRegex(template, options));
      const compact = buildCompactPatternPredicate('Body', template, options)!;
      for (const value of values) {
        expect([template, value, matchesCompact(compact, value)]).toEqual([
          template,
          value,
          full.test(value),
        ]);
      }
      expect(parsePatternPredicate(compact, options)?.template).toBe(template);
    }
    // `.` is a literal, so only the template's own text matches.
    const compact = buildCompactPatternPredicate(
      'Body',
      'GET /api/v1.2 (ok) $5 a|b',
    )!;
    expect(matchesCompact(compact, 'GET /api/v1.2 (ok) $5 a|b')).toBe(true);
    expect(matchesCompact(compact, 'GET /api/v1x2 (ok) $5 a|b')).toBe(false);
  });

  it('builds no predicate for a token that holds a delimiter', () => {
    // Mined without delimiters, then built with them: normalizing would split
    // `db-1:5432`, so the compact form can't match what the full one does.
    const template = 'Connection to db-1:5432 timed out';
    expect(
      buildCompactPatternPredicate('Body', template, withPunctuation),
    ).toBeNull();
    expect(buildPatternPredicate('Body', template, withPunctuation)).not.toBe(
      null,
    );
    expect(buildCompactPatternPredicate('Body', template)).not.toBeNull();
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

  it('reads back tokens that hold quotes, backslashes and regex syntax', () => {
    // Without delimiters a token keeps its punctuation.
    const expr = "JSONExtractString(Body, 'msg')";
    const template = "it's C:\\tmp\\a.txt (ok) <*>";
    const predicate = buildPatternPredicate(expr, template)!;
    expect(parsePatternPredicate(predicate)).toEqual({
      valueExpression: expr,
      template,
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

// Mines with the default masks, as the MCP tools do.
function mineWithMasks(messages: string[]) {
  return minePatterns(
    messages.map(body => ({ body })),
    {
      totalCount: messages.length,
      startDate: new Date(0),
      endDate: new Date(1000),
      trendBuckets: 0,
      maxSamples: messages.length,
      getBody: r => r.body,
      getTimestamp: () => 0,
    },
  ).patterns;
}

describe('templateToRegex with masks', () => {
  const matches = (
    template: string,
    value: string,
    options: PatternRegexOptions = withDates,
  ) => toJsRegex(templateToRegex(template, options)).test(value);

  it('a masked date is one word, also inside a token', () => {
    expect(
      matches('wrote backup_<DATE>.tar', 'wrote backup_2026-11-04.tar'),
    ).toBe(true);
    expect(matches('wrote backup_<DATE>.tar', 'wrote backup_.tar')).toBe(false);
    expect(
      matches('wrote backup_<DATE>.tar', 'wrote backup_2026-11-04.tar.gz'),
    ).toBe(false);
    expect(
      matches('I<DATE> <*> sync done', 'I1104 06:12:12.345678 sync done'),
    ).toBe(true);
    expect(
      matches('<DATE> <*> INFO x', '2026-11-04\n06:12:12,345 INFO x'),
    ).toBe(true);
    expect(matches('<DATE> <*> INFO x', '2026-11-04 INFO x')).toBe(false);
  });

  it('with delimiters, a mask matches a date of up to three parts', () => {
    const m = (template: string, value: string) =>
      matches(template, value, PATTERN_REGEX_OPTIONS);
    expect(m('<DATE> started', '2026-11-04 started')).toBe(true);
    expect(m('access <DATE> 12', 'access [04/Nov/2026:12]')).toBe(true);
    expect(m('<DATE> <DATE> <DATE> up', 'Wed, Nov 4 up')).toBe(true);
    expect(m('<DATE> started', '2026-11-04-01 started')).toBe(false);
    expect(m('<DATE> started', 'boot started')).toBe(false);
    expect(m('<DATE> started', 'job-42-x started')).toBe(false);
  });

  it('with delimiters, a mask touches only a severity letter or a T time', () => {
    const m = (template: string, value: string) =>
      matches(template, value, PATTERN_REGEX_OPTIONS);
    expect(m('<DATE> T06 started', '2026-11-04T06 started')).toBe(true);
    expect(m('<DATE> <*> started', '2026-11-04T06 started')).toBe(true);
    expect(m('<DATE> <*> started', '2026-11-04 boot started')).toBe(true);
    expect(m('I <DATE> <*> done', 'I1104 06 done')).toBe(true);
    expect(m('<*> <DATE> <*> done', 'E1104 06 done')).toBe(true);
    expect(m('<*> <DATE> <*> done', 'job 2026-11-04 06 done')).toBe(true);
    expect(m('ts <DATE> <*> msg done', 'tsunami 5 msg done')).toBe(false);
    expect(m('ts <DATE> <*> msg done', 'ts 2026-11-04 5 msg done')).toBe(true);
    expect(m('<DATE> started', '2026-11-04x started')).toBe(false);
    expect(m('x <DATE> started', 'x2026-11-04 started')).toBe(false);
    expect(
      buildCompactPatternPredicate(
        'Body',
        '<DATE> T06 x',
        PATTERN_REGEX_OPTIONS,
      ),
    ).not.toBeNull();
  });

  it('keeps <DATE> literal without the option', () => {
    const t = 'wrote backup_<DATE>.tar';
    expect(matches(t, 'wrote backup_<DATE>.tar', {})).toBe(true);
    expect(matches(t, 'wrote backup_2026-11-04.tar', {})).toBe(false);
  });

  it('matches the samples of patterns mined from dated lines', () => {
    const patterns = mineWithMasks([
      ...[1, 2, 3].map(
        n =>
          `2026-11-0${n} 06:12:1${n},345 INFO [main] c.e.Job - Sync ok for 10${n}`,
      ),
      ...[4, 5].map(n => `[0${n}/Nov/2026:06:12:12 +0000] "GET /health" 200`),
      ...[
        '4bf92f3577b34da6a3ce929d0e0e4736',
        '00f067aa0ba902b7a3ce929d0e0e4736',
      ].map(id => `exported span trace_id=${id} status=ok`),
      ...[3, 4].map(n => `Nov  ${n} 06:12:12 host sshd[42]: session opened`),
    ]);
    expect(patterns).toHaveLength(4);
    for (const p of patterns) {
      const re = toJsRegex(templateToRegex(p.pattern, PATTERN_REGEX_OPTIONS));
      for (const s of p.samples) expect(re.test(s.body)).toBe(true);
      for (const o of patterns.filter(o => o !== p).flatMap(o => o.samples)) {
        expect(re.test(o.body)).toBe(false);
      }
    }
  });

  it('matches every sample when a masked timestamp and a word share a position', () => {
    const patterns = mineWithMasks([
      'Started job at 2026-11-04 06:12:12',
      'Started job at boot',
      'Started job at shutdown',
      'Started job at 2026-11-04T06:12:13Z',
    ]);
    // Punctuation splits the times into several tokens, so the dated lines
    // share a cluster with each other, not with the one-word lines.
    expect(patterns.map(p => p.pattern).sort()).toEqual([
      'Started job at <*>',
      'Started job at <DATE> <*> 12 <*>',
    ]);
    for (const p of patterns) {
      const re = toJsRegex(templateToRegex(p.pattern, PATTERN_REGEX_OPTIONS));
      for (const sample of p.samples) expect(re.test(sample.body)).toBe(true);
    }
  });
});
