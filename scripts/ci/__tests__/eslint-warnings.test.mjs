import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectWarnings,
  newWarnings,
  parseAddedLines,
  parseArgs,
} from '../eslint-warnings.mjs';

const ROOT = '/repo';

test('parseArgs splits wrapper flags from ESLint args', () => {
  assert.deepEqual(parseArgs(['.', '--ext', '.ts', '--max-warnings', '302']), {
    eslintArgs: ['.', '--ext', '.ts'],
    maxWarnings: 302,
    staged: false,
  });
  assert.deepEqual(parseArgs(['--staged', '--fix', '/repo/a.ts']), {
    eslintArgs: ['--fix', '/repo/a.ts'],
    maxWarnings: undefined,
    staged: true,
  });
  assert.equal(parseArgs(['--max-warnings=0']).maxWarnings, 0);
  assert.throws(() => parseArgs(['--max-warnings', 'lots']));
});

test('parseAddedLines maps new-side hunk ranges per file', () => {
  const diff = [
    'diff --git a/packages/api/src/a.ts b/packages/api/src/a.ts',
    '--- a/packages/api/src/a.ts',
    '+++ b/packages/api/src/a.ts',
    '@@ -3 +3 @@ x',
    '-old',
    '+new',
    '@@ -10,0 +11,3 @@',
    '+a',
    '+b',
    '+c',
    '@@ -20,2 +23,0 @@',
    '-gone',
    '-gone',
    'diff --git a/packages/api/src/deleted.ts b/packages/api/src/deleted.ts',
    '--- a/packages/api/src/deleted.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-x',
    '-y',
    'diff --git a/packages/app/b.tsx b/packages/app/b.tsx',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/packages/app/b.tsx',
    '@@ -0,0 +1,2 @@',
    '+one',
    '+two',
  ].join('\n');

  const added = parseAddedLines(diff, ROOT);
  assert.deepEqual(
    [...added.get('/repo/packages/api/src/a.ts')],
    [3, 11, 12, 13],
  );
  assert.deepEqual([...added.get('/repo/packages/app/b.tsx')], [1, 2]);
  assert.equal(added.has('/repo/packages/api/src/deleted.ts'), false);
});

const results = [
  {
    filePath: '/repo/packages/api/src/a.ts',
    messages: [
      { severity: 1, line: 3, column: 1, ruleId: 'r1', message: 'new' },
      { severity: 1, line: 40, column: 1, ruleId: 'r1', message: 'old' },
      { severity: 2, line: 3, column: 5, ruleId: 'r2', message: 'error' },
    ],
  },
  {
    filePath: '/repo/packages/api/src/untouched.ts',
    messages: [
      { severity: 1, line: 3, column: 1, ruleId: 'r1', message: 'other' },
    ],
  },
];

test('collectWarnings keeps only warnings, tagged with their file', () => {
  const warnings = collectWarnings(results);
  assert.deepEqual(
    warnings.map(w => [w.filePath, w.line, w.message]),
    [
      ['/repo/packages/api/src/a.ts', 3, 'new'],
      ['/repo/packages/api/src/a.ts', 40, 'old'],
      ['/repo/packages/api/src/untouched.ts', 3, 'other'],
    ],
  );
  assert.equal(warnings[0].raw, results[0].messages[0]);
});

test('newWarnings prefers warnings on changed lines', () => {
  const added = new Map([['/repo/packages/api/src/a.ts', new Set([3])]]);
  const { scope, warnings } = newWarnings(collectWarnings(results), added);
  assert.equal(scope, 'lines');
  assert.deepEqual(
    warnings.map(w => w.message),
    ['new'],
  );
});

test('newWarnings falls back to changed files when no changed line warns', () => {
  const added = new Map([['/repo/packages/api/src/a.ts', new Set([7])]]);
  const { scope, warnings } = newWarnings(collectWarnings(results), added);
  assert.equal(scope, 'files');
  assert.deepEqual(
    warnings.map(w => w.message),
    ['new', 'old'],
  );
});
