import assert from 'node:assert/strict';
import test from 'node:test';

import { commentBody, lintSection, sizeSection } from '../quality-report.mjs';

test('file size section lists the largest files first', () => {
  const out = sizeSection({ 'a.ts': 400, 'b.ts': 900 });
  assert.match(out, /2 source files over 300 lines, 700 lines over/);
  assert.ok(out.indexOf('b.ts') < out.indexOf('a.ts'));
});

test('lint section totals each rule across packages, most common first', () => {
  const out = lintSection({
    api: { limit: 5, rules: { complexity: 2, 'max-depth': 3 } },
    app: { limit: 9, rules: { complexity: 4 } },
  });
  assert.match(out, /\| `complexity` \| 2 \| 4 \| 6 \|/);
  assert.match(out, /\| `max-depth` \| 3 \| 0 \| 3 \|/);
  assert.ok(out.indexOf('complexity') < out.indexOf('max-depth'));
  assert.match(out, /api 5\/5, app 4\/9 \(count\/limit\)/);
  assert.match(out, /\| \*\*Total\*\* \| 5 \| 4 \|/);
  assert.match(out, /\| \*\*Limit\*\* \| 5 \| 9 \|/);
});

test('the PR comment is the totals and a link to the full report', () => {
  const out = commentBody(
    { 'a.ts': 400, 'b.ts': 900 },
    { api: { limit: 5, rules: { complexity: 2, 'max-depth': 3 } } },
    'https://example.test/runs/1',
  );
  assert.equal(
    out,
    [
      '## Code quality report',
      '- 2 source files over 300 lines, 700 lines over the limit in total',
      '- oxlint warnings (count/limit): api 5/5',
      '',
      '[Full report](https://example.test/runs/1)',
    ].join('\n'),
  );
});
