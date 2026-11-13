import { TemplateMinerConfig } from '@/drain/config';
import {
  buildPatternPredicate,
  parsePatternPredicate,
  templateToRegex,
} from '@/drain/pattern-predicate';
import { TemplateMiner } from '@/drain/template-miner';

// Python's string.punctuation, the extra delimiters the app's miner uses.
const PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split('');
const withPunctuation = { extraDelimiters: PUNCTUATION };

// RE2 spells code points \x{HHHH} and categories \pZ; JS (with the u flag)
// spells them \u{HHHH} and \p{Z}, and has no POSIX classes.
function toJsRegex(re2: string): RegExp {
  return RegExp(
    re2
      .replace(/\\x\{([0-9A-Fa-f]+)\}/g, '\\u{$1}')
      .replace(/(?<!\\)\\p([A-Z])/g, '\\p{$1}')
      .replaceAll('[:punct:]', '!-\\/:-@\\[-`{-~'),
    'u',
  );
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
    const config = new TemplateMinerConfig();
    config.drainExtraDelimiters = PUNCTUATION;
    const miner = new TemplateMiner(config);
    const messages = [
      'Connection to db-1:5432 timed out after 30s (retry 1/3)',
      'Connection to db-2:5432 timed out after 30s (retry 2/3)',
      'user=alice action=login status=ok',
      'user=bob action=login status=ok',
      '[2026-04-17T08:35:57.725Z] "GET /api/products/2ZYF HTTP/1.1" 200 -',
      '[2026-04-17T08:36:02.101Z] "GET /api/products/L9EC HTTP/1.1" 200 -',
      'path=C:\\temp\\a.txt mode=[r^w] note={a|b} cost=$5 ~ok',
      'path=C:\\temp\\b.txt mode=[r^w] note={a|b} cost=$7 ~ok',
    ];
    const members = new Map<number, string[]>();
    for (const message of messages) {
      const { clusterId } = miner.addLogMessage(message);
      members.set(clusterId, [...(members.get(clusterId) ?? []), message]);
    }
    for (const [clusterId, clusterMembers] of members) {
      const template = miner.drain.getCluster(clusterId)!.getTemplate();
      const regex = toJsRegex(templateToRegex(template, withPunctuation));
      for (const message of messages) {
        expect(regex.test(message)).toBe(clusterMembers.includes(message));
      }
    }
  });
});

describe('parsePatternPredicate', () => {
  it.each([
    ['Body', 'GET api v1 users <*> <*> <*>'],
    ["JSONExtractString(Body, 'message')", 'user <*> action login status ok'],
    ['Body', '<*>'],
  ])('reads back what buildPatternPredicate built (%s)', (expr, template) => {
    const predicate = buildPatternPredicate(expr, template, withPunctuation)!;
    expect(parsePatternPredicate(predicate, withPunctuation)).toEqual({
      valueExpression: expr,
      template,
    });
  });

  it('rejects other conditions', () => {
    expect(parsePatternPredicate("ServiceName IN ('api')")).toBeNull();
    expect(parsePatternPredicate("match(Body, 'timed out')")).toBeNull();
    expect(
      parsePatternPredicate(
        buildPatternPredicate('Body', 'Sending <*> rows')!,
        withPunctuation,
      ),
    ).toBeNull();
  });
});
