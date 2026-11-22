import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectCounts,
  collectLargeFiles,
  compare,
  compareSizes,
  discoverPackages,
  nextSizeBaseline,
} from '../ratchet.mjs';

/** Builds a throwaway workspace: { pkgName: { 'src/a.ts': 'source' } }. */
function fixture(packages, workspaces = ['packages/*']) {
  const root = mkdtempSync(path.join(tmpdir(), 'ratchet-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'root', private: true, workspaces }),
  );
  for (const [pkg, files] of Object.entries(packages)) {
    const dir = path.join(root, 'packages', pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: pkg }),
    );
    for (const [rel, source] of Object.entries(files)) {
      const file = path.join(dir, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
  }
  test.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('counts escape hatches across a package, not just src/', () => {
  const root = fixture({
    app: {
      'src/a.ts': 'const x = y as any;\n// @ts-ignore\n',
      'scripts/gen.ts': '// eslint-disable-next-line no-console\n',
    },
  });
  assert.deepEqual(collectCounts(root), {
    app: { 'as-any': 1, 'ts-ignore': 1, 'eslint-disable': 1, '@source': 0 },
  });
});

test('oxlint-disable comments count as disable directives too', () => {
  const root = fixture({
    app: {
      'src/a.ts':
        '// oxlint-disable-next-line no-console\n// eslint-disable-line no-var\n',
    },
  });
  assert.equal(collectCounts(root).app['eslint-disable'], 2);
});

test('`as any` is word-anchored, so prose does not inflate the count', () => {
  const root = fixture({
    app: {
      'src/a.ts': [
        '// true if the user has any dashboards',
        'const klass = node as anything;',
        'const real = node as any;',
      ].join('\n'),
    },
  });
  assert.equal(collectCounts(root).app['as-any'], 1);
});

test('skips node_modules and build output', () => {
  const root = fixture({
    app: {
      'src/a.ts': 'const x = y as any;',
      'node_modules/dep/index.ts': 'const a = b as any;',
      'dist/bundle.ts': 'const a = b as any;',
      // `NEXT_DIST_DIR` renames this, so it is matched by prefix.
      '.next/dev/types/validator.ts': 'const a = b as any;',
      '.next-e2e/dev/types/validator.ts': 'const a = b as any;',
    },
  });
  assert.equal(collectCounts(root).app['as-any'], 1);
});

test('discovers new workspace packages automatically', () => {
  const root = fixture({
    app: { 'src/a.ts': '' },
    'brand-new': { 'src/a.ts': 'const x = y as any;' },
  });
  assert.deepEqual([...discoverPackages(root).keys()].sort(), [
    'app',
    'brand-new',
  ]);
  // Not in the baseline yet, so its implicit ceiling is zero.
  assert.equal(compare(collectCounts(root), { app: {} }).failed, true);
});

test('above baseline fails', () => {
  const { failed, messages } = compare(
    { app: { 'as-any': 3, 'ts-ignore': 0, 'eslint-disable': 0 } },
    { app: { 'as-any': 2, 'ts-ignore': 0, 'eslint-disable': 0 } },
  );
  assert.equal(failed, true);
  assert.match(messages.join('\n'), /app\/as-any: 3 > baseline 2/);
});

test('an advisory pattern above baseline warns instead of failing', () => {
  const { failed, messages } = compare(
    {
      cli: { 'as-any': 0, 'ts-ignore': 0, 'eslint-disable': 0, '@source': 38 },
    },
    {
      cli: { 'as-any': 0, 'ts-ignore': 0, 'eslint-disable': 0, '@source': 37 },
    },
  );
  assert.equal(failed, false);
  assert.match(messages.join('\n'), /! cli\/@source: 38 > baseline 37/);
});

test('an advisory rise does not mask a gated pattern rising too', () => {
  const { failed, messages } = compare(
    {
      cli: { 'as-any': 1, 'ts-ignore': 0, 'eslint-disable': 0, '@source': 38 },
    },
    {
      cli: { 'as-any': 0, 'ts-ignore': 0, 'eslint-disable': 0, '@source': 37 },
    },
  );
  assert.equal(failed, true);
  assert.match(messages.join('\n'), /x cli\/as-any: 1 > baseline 0/);
});

test('at baseline passes quietly', () => {
  const counts = { app: { 'as-any': 2, 'ts-ignore': 0, 'eslint-disable': 0 } };
  assert.deepEqual(compare(counts, counts), {
    failed: false,
    improved: false,
    messages: [],
  });
});

test('below baseline warns but does not fail', () => {
  const { failed, improved, messages } = compare(
    { app: { 'as-any': 1, 'ts-ignore': 0, 'eslint-disable': 0 } },
    { app: { 'as-any': 2, 'ts-ignore': 0, 'eslint-disable': 0 } },
  );
  assert.equal(failed, false);
  assert.equal(improved, true);
  assert.match(messages.join('\n'), /app\/as-any: 1 < baseline 2/);
});

test('a baselined package that vanished is a hard error, not a free pass', () => {
  const { failed, messages } = compare(
    {},
    { app: { 'as-any': 212, 'ts-ignore': 11, 'eslint-disable': 133 } },
  );
  assert.equal(failed, true);
  assert.match(messages.join('\n'), /not a workspace package any more/);
});

test('the committed baseline is not already breached by the real repo', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../../..');
  const baseline = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'scripts/ci/ratchet-baseline.json'),
      'utf8',
    ),
  );
  // Only asserts not-above-baseline: below-baseline is a deliberate warn.
  assert.equal(compare(collectCounts(repoRoot), baseline).failed, false);
});

test('collects only non-test source files over the line limit', () => {
  const long = 'x;\n'.repeat(301);
  const root = fixture({
    app: {
      'src/big.ts': long,
      'src/ok.ts': 'x;\n'.repeat(300),
      'src/__tests__/big.test.ts': long,
    },
  });
  assert.deepEqual(collectLargeFiles(root), { 'packages/app/src/big.ts': 301 });
});

test('a new large file or a grown one fails; a shrunk one only warns', () => {
  const baseline = { 'a.ts': 500, 'b.ts': 500 };
  assert.equal(
    compareSizes({ ...baseline, 'new.ts': 301 }, baseline).failed,
    true,
  );
  assert.equal(
    compareSizes({ 'a.ts': 501, 'b.ts': 500 }, baseline).failed,
    true,
  );
  const shrunk = compareSizes({ 'a.ts': 400 }, baseline);
  assert.equal(shrunk.failed, false);
  assert.equal(shrunk.messages.length, 2);
});

test('a moved file points at ratchet:update instead of asking for a split', () => {
  const { failed, messages } = compareSizes(
    { 'new/a.ts': 500 },
    { 'a.ts': 500 },
  );
  assert.equal(failed, true);
  assert.match(messages[0], /moved or split from a\.ts/);
});

test('update records shrinkage and moves but refuses growth unless allowed', () => {
  const baseline = { 'a.ts': 500, 'b.ts': 500, 'old.ts': 900 };
  const current = { 'a.ts': 400, 'b.ts': 600, 'moved.ts': 900, 'new.ts': 950 };
  assert.deepEqual(nextSizeBaseline(current, baseline), {
    next: { 'a.ts': 400, 'b.ts': 500, 'moved.ts': 900 },
    refused: ['b.ts', 'new.ts'],
  });
  assert.deepEqual(nextSizeBaseline(current, baseline, true), {
    next: current,
    refused: [],
  });
});
