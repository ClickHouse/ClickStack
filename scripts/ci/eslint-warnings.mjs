#!/usr/bin/env node
/**
 * ESLint wrapper that says which warnings are new.
 *
 * Ceiling mode (each package's `lint` script):
 *   node ../../scripts/ci/eslint-warnings.mjs . --ext .ts --max-warnings 302
 * Runs ESLint, then, when the warning count exceeds the ceiling, lists the
 * warnings on lines this branch changed (vs the merge-base with the PR base or
 * origin/main) and emits GitHub annotations for them. Plain
 * `eslint --max-warnings` only prints "too many warnings" somewhere inside
 * hundreds of pre-existing ones.
 *
 * Staged mode (lint-staged pre-commit):
 *   node scripts/ci/eslint-warnings.mjs --staged --fix <files>
 * Fails only on warnings on lines the commit adds or changes, so touching a
 * file with old warnings doesn't block the commit.
 *
 * Every other argument is passed through to ESLint.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const eslintArgs = [];
  let maxWarnings;
  let staged = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--staged') {
      staged = true;
    } else if (arg === '--max-warnings') {
      maxWarnings = Number(argv[++i]);
    } else if (arg.startsWith('--max-warnings=')) {
      maxWarnings = Number(arg.slice('--max-warnings='.length));
    } else {
      eslintArgs.push(arg);
    }
  }
  if (maxWarnings !== undefined && !Number.isInteger(maxWarnings)) {
    throw new Error('--max-warnings needs an integer');
  }
  return { eslintArgs, maxWarnings, staged };
}

/**
 * Parses `git diff --unified=0` output into absolute path -> Set of line
 * numbers that exist on the new side of the diff.
 */
export function parseAddedLines(diff, root) {
  const added = new Map();
  let lines;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      lines = target === '/dev/null' ? undefined : new Set();
      if (lines)
        added.set(path.resolve(root, target.replace(/^b\//, '')), lines);
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && lines) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) lines.add(n);
    }
  }
  return added;
}

export function collectWarnings(results) {
  return results.flatMap(result =>
    result.messages
      .filter(message => message.severity === 1)
      .map(message => ({
        ...message,
        filePath: result.filePath,
        raw: message,
      })),
  );
}

/**
 * Warnings on changed lines. When there are none (a type change can make a
 * type-aware rule fire on untouched code), falls back to every warning in a
 * changed file. `scope` says which one the list is.
 */
export function newWarnings(warnings, addedLines) {
  const onLines = warnings.filter(w => addedLines.get(w.filePath)?.has(w.line));
  if (onLines.length) return { scope: 'lines', warnings: onLines };
  return {
    scope: 'files',
    warnings: warnings.filter(w => addedLines.has(w.filePath)),
  };
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

const DIFF_ARGS = [
  'diff',
  '--unified=0',
  '--no-color',
  '--no-ext-diff',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];

/** Returns { base, addedLines }, or undefined when git can't tell. */
function changedLines(root, staged) {
  try {
    // lint-staged hides unstaged edits, so the working tree is the staged
    // content plus whatever --fix just wrote.
    if (staged) {
      return {
        base: 'HEAD',
        addedLines: parseAddedLines(git([...DIFF_ARGS, 'HEAD'], root), root),
      };
    }
    const baseRef = `origin/${process.env.GITHUB_BASE_REF || 'main'}`;
    const mergeBase = git(['merge-base', 'HEAD', baseRef], root).trim();
    return {
      base: baseRef,
      addedLines: parseAddedLines(git([...DIFF_ARGS, mergeBase], root), root),
    };
  } catch {
    return undefined;
  }
}

function formatWarning(w, root) {
  const where = `${path.relative(root, w.filePath)}:${w.line}:${w.column}`;
  return `  ${where}  ${w.message}  ${w.ruleId ?? ''}`.trimEnd();
}

function annotate(warnings, root) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  for (const w of warnings) {
    const file = path.relative(root, w.filePath);
    const message = `${w.message} (${w.ruleId})`.replace(/\r?\n/g, ' ');
    console.log(
      `::error file=${file},line=${w.line},col=${w.column},title=New ESLint warning::${message}`,
    );
  }
}

function runEslint(cwd, eslintArgs) {
  const require = createRequire(path.join(cwd, 'noop.js'));
  const pkgJson = require.resolve('eslint/package.json');
  const bin = path.join(path.dirname(pkgJson), 'bin/eslint.js');
  const tmp = mkdtempSync(path.join(tmpdir(), 'eslint-warnings-'));
  const outFile = path.join(tmp, 'results.json');
  try {
    const { status } = spawnSync(
      process.execPath,
      [bin, ...eslintArgs, '--format', 'json', '--output-file', outFile],
      { cwd, stdio: 'inherit' },
    );
    let results;
    try {
      results = JSON.parse(readFileSync(outFile, 'utf8'));
    } catch {
      // ESLint crashed (bad config, bad flag) and has already said why.
      process.exit(status || 2);
    }
    return { status, results, ESLint: require('eslint').ESLint };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Keeps errors plus the given warnings, recomputing the counts. */
function onlyErrorsAnd(results, kept) {
  return results.map(result => {
    const messages = result.messages.filter(
      m => m.severity === 2 || kept.has(m),
    );
    return {
      ...result,
      messages,
      errorCount: messages.filter(m => m.severity === 2).length,
      warningCount: messages.filter(m => m.severity === 1).length,
    };
  });
}

async function main() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const cwd = process.cwd();
  const { eslintArgs, maxWarnings, staged } = parseArgs(process.argv.slice(2));
  const { status, results, ESLint } = runEslint(cwd, eslintArgs);
  const stylish = await new ESLint({ cwd }).loadFormatter('stylish');
  const warnings = collectWarnings(results);
  const hasErrors = results.some(r => r.errorCount > 0) || status === 2;

  if (staged) {
    const changed = changedLines(root, true);
    const fresh = changed
      ? warnings.filter(w => changed.addedLines.get(w.filePath)?.has(w.line))
      : [];
    process.stdout.write(
      await stylish.format(
        onlyErrorsAnd(results, new Set(fresh.map(w => w.raw))),
      ),
    );
    if (fresh.length) {
      console.error(
        `\n✖ ${fresh.length} new ESLint warning(s) on lines this commit changes. ` +
          'Fix them before committing; CI caps the warning count per package.',
      );
    }
    return hasErrors || fresh.length ? 1 : 0;
  }

  process.stdout.write(await stylish.format(results));
  if (maxWarnings === undefined || warnings.length <= maxWarnings) {
    if (maxWarnings !== undefined && warnings.length < maxWarnings) {
      console.log(
        `${warnings.length} ESLint warnings, ceiling ${maxWarnings}. ` +
          `Lower --max-warnings to ${warnings.length} to lock in the improvement.`,
      );
    }
    return hasErrors ? 1 : 0;
  }

  const pkg = path.relative(root, cwd) || '.';
  const summary =
    `${pkg}: ${warnings.length} ESLint warnings, ceiling is ${maxWarnings} ` +
    `(--max-warnings in ${path.join(pkg, 'package.json')}).`;
  console.error(`\n✖ ${summary}`);
  const changed = changedLines(root, false);
  if (!changed) {
    console.error(
      'Could not diff against the base branch to find new warnings.',
    );
  } else {
    const { scope, warnings: fresh } = newWarnings(
      warnings,
      changed.addedLines,
    );
    if (fresh.length) {
      console.error(
        scope === 'lines'
          ? `Warnings on lines changed since ${changed.base}:`
          : `No warnings on changed lines (a type change can flag untouched code). Warnings in files changed since ${changed.base}:`,
      );
      for (const w of fresh) console.error(formatWarning(w, root));
      annotate(fresh, root);
    } else {
      console.error(`No warnings in files changed since ${changed.base}.`);
    }
  }
  console.error(
    'Fix the new warnings. Raise the ceiling only if the increase is deliberate.',
  );
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::error title=ESLint warning ceiling exceeded::${summary}`);
  }
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Not process.exit(): it drops stdout still queued for a pipe (CI, nx).
  process.exitCode = await main();
}
