#!/usr/bin/env node
/**
 * Ratchet: counts of tracked escape hatches may only go down.
 * Above baseline -> fail (you added one; remove it).
 * Below baseline -> warn only (run `yarn ratchet:update` to lock the
 *   improvement in). Non-fatal so an improvement can never turn `main` red —
 *   e.g. when two count-lowering PRs merge close together and `main`'s
 *   committed baseline briefly sits above the real count.
 * Advisory patterns (see ADVISORY) are counted and reported but never fail.
 * File sizes get the same treatment per file: see compareSizes.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PATTERNS = {
  // Word-anchored: a bare `as any` substring also matches prose like
  // "...has any dashboards", inflating the baseline with phantom counts.
  'as-any': /\bas any\b/g,
  'ts-ignore': /@ts-ignore/g,
  // oxlint honours both spellings, so both count.
  'eslint-disable': /(?:eslint|oxlint)-disable/g,
  // Duplication licensed by comment. `@source` marks code copied from another
  // package (mostly packages/cli/src/shared today, plus a handful under
  // src/components, src/utils and src/api).
  '@source': /@source packages\//g,
};

/**
 * Counted and reported, never fatal.
 *
 * `@source` is a doc comment, not an escape hatch. Deleting an `as any` or an
 * `eslint-disable` forces the underlying problem to surface; deleting an
 * `@source` line removes the record of a copy, not the copy. Gating on it would
 * only teach people to stop annotating their ports — the one behaviour that
 * makes the duplication findable. So the number is tracked and surfaced, and
 * lowering it means moving the code into `common-utils`.
 */
export const ADVISORY = new Set(['@source']);

// Generated, vendored or build output — not ours to ratchet.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.nx',
  '.turbo',
  // .next* is skipped by prefix below
]);
const EXTS = new Set(['.ts', '.tsx']);

/**
 * `.next` by prefix, not exact name: `NEXT_DIST_DIR` moves the build output
 * (E2E runs use `.next-e2e`).
 */
function isSkippedDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.next');
}

/**
 * Workspace package directories, keyed by directory name. Derived from the
 * root `workspaces` globs rather than hardcoded, so a newly added package is
 * gated from day one instead of being silently ungated.
 */
export function discoverPackages(root) {
  const { workspaces } = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  const globs = Array.isArray(workspaces)
    ? workspaces
    : (workspaces?.packages ?? []);
  const found = new Map();
  for (const glob of globs) {
    // ponytail: only the `dir/*` and literal-path forms this repo uses; reach
    // for a glob library if the workspaces field ever gets fancier.
    let candidates;
    if (glob.endsWith('/*')) {
      const parent = glob.slice(0, -2);
      const parentDir = path.join(root, parent);
      candidates = existsSync(parentDir)
        ? readdirSync(parentDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(parent, entry.name))
        : [];
    } else {
      candidates = [glob];
    }
    for (const rel of candidates) {
      if (existsSync(path.join(root, rel, 'package.json'))) {
        found.set(path.basename(rel), path.join(root, rel));
      }
    }
  }
  return found;
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!isSkippedDir(entry.name)) yield* sourceFiles(full);
    } else if (entry.isFile() && EXTS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

function countDir(dir) {
  const counts = Object.fromEntries(Object.keys(PATTERNS).map(n => [n, 0]));
  for (const file of sourceFiles(dir)) {
    const src = readFileSync(file, 'utf8');
    for (const [name, re] of Object.entries(PATTERNS)) {
      counts[name] += src.match(re)?.length ?? 0;
    }
  }
  return counts;
}

export const MAX_FILE_LINES = 300;

// Tests, stories and type declarations are long for reasons that splitting
// does not fix.
const SIZE_EXEMPT =
  /(^|\/)(__tests__|__mocks__|__fixtures__|tests|migrations)\/|\.(test|spec|stories)\.tsx?$|\.d\.ts$/;

/** Line counts of source files over MAX_FILE_LINES, keyed by repo-relative path. */
export function collectLargeFiles(root) {
  const large = {};
  for (const dir of discoverPackages(root).values()) {
    for (const file of sourceFiles(dir)) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (SIZE_EXEMPT.test(rel)) continue;
      const lines = readFileSync(file, 'utf8').trimEnd().split('\n').length;
      if (lines > MAX_FILE_LINES) large[rel] = lines;
    }
  }
  return Object.fromEntries(
    Object.entries(large).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** A baselined file that is gone, or now under the limit, and was at least this long. */
function movedFrom(lines, current, baseline) {
  return Object.keys(baseline).find(
    old => !(old in current) && baseline[old] >= lines,
  );
}

/**
 * A file already over the limit may not grow, and no other file may cross it.
 * @returns {{failed: boolean, messages: string[]}}
 */
export function compareSizes(current, baseline) {
  const messages = [];
  let failed = false;
  for (const [file, lines] of Object.entries(current)) {
    const max = baseline[file];
    const source = max === undefined && movedFrom(lines, current, baseline);
    if (source) {
      failed = true;
      messages.push(
        `x ${file}: ${lines} lines, moved or split from ${source} — run \`yarn ratchet:update\``,
      );
    } else if (max === undefined) {
      failed = true;
      messages.push(
        `x ${file}: ${lines} lines > ${MAX_FILE_LINES} — split it into smaller files`,
      );
    } else if (lines > max) {
      failed = true;
      messages.push(
        `x ${file}: ${lines} lines > baseline ${max} — already over ${MAX_FILE_LINES}, so put the new code in another file`,
      );
    }
  }
  for (const [file, max] of Object.entries(baseline)) {
    if ((current[file] ?? 0) < max) {
      messages.push(
        `! ${file}: ${current[file] ?? `under ${MAX_FILE_LINES + 1}`} lines < baseline ${max} — run \`yarn ratchet:update\` to lock the improvement in`,
      );
    }
  }
  return { failed, messages };
}

/**
 * The baseline `--update` writes. Without `allowGrowth` it only records
 * shrinkage and moves, so the command the warnings recommend cannot also
 * accept a file that grew.
 * @returns {{next: Record<string, number>, refused: string[]}}
 */
export function nextSizeBaseline(current, baseline, allowGrowth = false) {
  const next = {};
  const refused = [];
  for (const [file, lines] of Object.entries(current)) {
    const max =
      baseline[file] ?? baseline[movedFrom(lines, current, baseline) ?? ''];
    if (allowGrowth || lines <= max) {
      next[file] = lines;
    } else {
      refused.push(file);
      if (file in baseline) next[file] = baseline[file];
    }
  }
  return { next, refused };
}

/** Escape-hatch counts for every workspace package, keyed by package dir name. */
export function collectCounts(root) {
  const current = {};
  for (const [name, dir] of [...discoverPackages(root)].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    current[name] = countDir(dir);
  }
  return current;
}

/** @returns {{failed: boolean, improved: boolean, messages: string[]}} */
export function compare(current, baseline) {
  const messages = [];
  let failed = false;
  let improved = false;

  // A baselined package that no longer resolves means enforcement just
  // silently dropped for it (renamed dir, moved package, deleted workspace).
  // Zero counts would sail through the non-fatal below-baseline branch, so
  // this has to be its own hard error.
  for (const pkg of Object.keys(baseline)) {
    if (!(pkg in current)) {
      failed = true;
      messages.push(
        `x ${pkg}: in the baseline but not a workspace package any more — drop it from the baseline if that's intended`,
      );
    }
  }

  for (const pkg of Object.keys(current)) {
    for (const name of Object.keys(PATTERNS)) {
      const now = current[pkg][name];
      const max = baseline[pkg]?.[name] ?? 0;
      if (now > max && ADVISORY.has(name)) {
        messages.push(
          `! ${pkg}/${name}: ${now} > baseline ${max} — advisory; move the copy into common-utils if you can, then run \`yarn ratchet:update\``,
        );
      } else if (now > max) {
        failed = true;
        messages.push(
          `x ${pkg}/${name}: ${now} > baseline ${max} — remove the new occurrence(s)`,
        );
      } else if (now < max) {
        // Non-fatal: an improvement must never fail CI (it would red `main`
        // and every open PR until someone re-baselines). Just nudge.
        improved = true;
        messages.push(
          `! ${pkg}/${name}: ${now} < baseline ${max} — run \`yarn ratchet:update\` to lock the improvement in`,
        );
      }
    }
  }
  return { failed, improved, messages };
}

function main() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const baselinePath = path.join(root, 'scripts/ci/ratchet-baseline.json');
  const sizePath = path.join(root, 'scripts/ci/file-size-baseline.json');
  const current = collectCounts(root);
  const sizes = collectLargeFiles(root);

  const sizeBaseline = existsSync(sizePath)
    ? JSON.parse(readFileSync(sizePath, 'utf8'))
    : {};

  if (process.argv.includes('--update')) {
    const { next, refused } = nextSizeBaseline(
      sizes,
      sizeBaseline,
      process.argv.includes('--allow-growth'),
    );
    writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
    writeFileSync(sizePath, JSON.stringify(next, null, 2) + '\n');
    console.log(
      `ratchet baselines written to ${path.relative(root, path.dirname(baselinePath))}`,
    );
    for (const file of refused) {
      console.error(
        `x ${file}: ${sizes[file]} lines not recorded — \`--update\` only lowers file sizes; split the file, or pass \`--allow-growth\` and say why in the PR`,
      );
    }
    return refused.length ? 1 : 0;
  }

  const counts = compare(
    current,
    JSON.parse(readFileSync(baselinePath, 'utf8')),
  );
  const size = compareSizes(sizes, sizeBaseline);
  const failed = counts.failed || size.failed;
  const messages = [...counts.messages, ...size.messages];
  for (const message of messages) {
    (message.startsWith('x ') ? console.error : console.warn)(message);
  }
  if (failed) return 1;
  console.log(
    messages.length
      ? 'ratchet ok: nothing above a gated baseline (see notes above)'
      : 'ratchet ok: all counts and file sizes at baseline',
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
