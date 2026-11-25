#!/usr/bin/env node
/**
 * oxlint wrapper that says which warnings are new.
 *
 * Ceiling mode (each package's `lint` script):
 *   node ../../scripts/ci/oxlint-warnings.mjs --max-warnings 302
 * Runs oxlint, then, when the warning count exceeds the ceiling, lists the
 * warnings on lines this branch changed (vs the merge-base with the PR base or
 * origin/main) and emits GitHub annotations for them. Plain
 * `oxlint --max-warnings` only prints "too many warnings" somewhere inside
 * hundreds of pre-existing ones.
 *
 * Staged mode (lint-staged pre-commit, from the repo root):
 *   node scripts/ci/oxlint-warnings.mjs --staged --fix <files>
 * Fails only on warnings on lines the commit adds or changes, so touching a
 * file with old warnings doesn't block the commit. oxlint lints each file
 * with the `.oxlintrc.json` of the package it lives in (nested configs).
 *
 * Every other argument is passed through to oxlint.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const oxlintArgs = [];
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
      oxlintArgs.push(arg);
    }
  }
  if (maxWarnings !== undefined && !Number.isInteger(maxWarnings)) {
    throw new Error('--max-warnings needs an integer');
  }
  return { oxlintArgs, maxWarnings, staged };
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

/**
 * Groups oxlint's `--format json` diagnostics into ESLint-style per-file
 * results, so the rest of this script (and its output) reads like before.
 * `code` is `plugin(rule)`; native ESLint rules drop the `eslint/` prefix.
 * Diagnostics without a code (unused disable directives, a JS plugin that
 * threw) keep `ruleId: null`.
 */
export function toResults(output, cwd) {
  const byFile = new Map();
  for (const d of output.diagnostics) {
    const filePath = path.resolve(cwd, d.filename);
    const span = d.labels?.[0]?.span;
    const match = /^(.+)\((.+)\)$/.exec(d.code ?? '');
    const ruleId = match
      ? match[1] === 'eslint'
        ? match[2]
        : `${match[1]}/${match[2]}`
      : null;
    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath).push({
      ruleId,
      severity: d.severity === 'error' ? 2 : 1,
      message: d.message,
      line: span?.line ?? 0,
      column: span?.column ?? 0,
    });
  }
  return [...byFile]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, messages]) => {
      messages.sort((a, b) => a.line - b.line || a.column - b.column);
      return {
        filePath,
        messages,
        errorCount: messages.filter(m => m.severity === 2).length,
        warningCount: messages.filter(m => m.severity === 1).length,
      };
    });
}

/** ESLint's `stylish` layout, which is what this script printed before. */
export function formatStylish(results, cwd) {
  let out = '';
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    if (!result.messages.length) continue;
    out += `\n${path.relative(cwd, result.filePath)}\n`;
    for (const m of result.messages) {
      const where = `${m.line}:${m.column}`.padStart(7);
      const level = m.severity === 2 ? 'error  ' : 'warning';
      out += `${where}  ${level}  ${m.message}  ${m.ruleId ?? ''}`.trimEnd();
      out += '\n';
    }
    errors += result.errorCount;
    warnings += result.warningCount;
  }
  const total = errors + warnings;
  if (total) {
    out +=
      `\n✖ ${total} problem${total === 1 ? '' : 's'} ` +
      `(${errors} error${errors === 1 ? '' : 's'}, ` +
      `${warnings} warning${warnings === 1 ? '' : 's'})\n`;
  }
  return out;
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

/** Per-file line sets present in both maps. */
export function intersectLines(a, b) {
  const both = new Map();
  for (const [file, lines] of a) {
    const other = b.get(file);
    if (other) both.set(file, new Set([...lines].filter(n => other.has(n))));
  }
  return both;
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
      const addedLines = parseAddedLines(
        git([...DIFF_ARGS, 'HEAD'], root),
        root,
      );
      // Concluding a merge: lines that came in unchanged from the other
      // parent are not this commit's, so only keep lines new to both sides.
      let theirs;
      try {
        theirs = parseAddedLines(git([...DIFF_ARGS, 'MERGE_HEAD'], root), root);
      } catch {
        return { base: 'HEAD', addedLines };
      }
      return { base: 'HEAD', addedLines: intersectLines(addedLines, theirs) };
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
      `::error file=${file},line=${w.line},col=${w.column},title=New oxlint warning::${message}`,
    );
  }
}

export function runOxlint(cwd, oxlintArgs) {
  const require = createRequire(path.join(cwd, 'noop.js'));
  const pkgJson = require.resolve('oxlint/package.json');
  const bin = path.join(path.dirname(pkgJson), 'bin/oxlint');
  const { status, stdout } = spawnSync(
    process.execPath,
    [bin, ...oxlintArgs, '--format', 'json'],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  try {
    return { status, results: toResults(JSON.parse(stdout), cwd) };
  } catch {
    // oxlint failed before linting (bad config, bad flag); it printed why.
    process.stdout.write(stdout ?? '');
    process.exit(status || 2);
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
  const { oxlintArgs, maxWarnings, staged } = parseArgs(process.argv.slice(2));
  // Staged files can all be ignored by their package config (next-env.d.ts),
  // which oxlint otherwise treats as an error.
  const { results } = runOxlint(
    cwd,
    staged ? ['--no-error-on-unmatched-pattern', ...oxlintArgs] : oxlintArgs,
  );
  const warnings = collectWarnings(results);
  const hasErrors = results.some(r => r.errorCount > 0);

  if (staged) {
    const changed = changedLines(root, true);
    const fresh = changed
      ? warnings.filter(w => changed.addedLines.get(w.filePath)?.has(w.line))
      : [];
    process.stdout.write(
      formatStylish(
        onlyErrorsAnd(results, new Set(fresh.map(w => w.raw))),
        cwd,
      ),
    );
    if (fresh.length) {
      console.error(
        `\n✖ ${fresh.length} new oxlint warning(s) on lines this commit changes. ` +
          'Fix them before committing; CI caps the warning count per package.',
      );
    }
    return hasErrors || fresh.length ? 1 : 0;
  }

  process.stdout.write(formatStylish(results, cwd));
  if (maxWarnings === undefined || warnings.length <= maxWarnings) {
    if (maxWarnings !== undefined && warnings.length < maxWarnings) {
      console.log(
        `${warnings.length} oxlint warnings, ceiling ${maxWarnings}. ` +
          `Lower --max-warnings to ${warnings.length} to lock in the improvement.`,
      );
    }
    return hasErrors ? 1 : 0;
  }

  const pkg = path.relative(root, cwd) || '.';
  const summary =
    `${pkg}: ${warnings.length} oxlint warnings, ceiling is ${maxWarnings} ` +
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
    console.log(`::error title=oxlint warning ceiling exceeded::${summary}`);
  }
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Not process.exit(): it drops stdout still queued for a pipe (CI, nx).
  process.exitCode = await main();
}
