#!/usr/bin/env node
// Markdown summary of file sizes and oxlint warnings, for the CI job summary.
// Advisory: the ratchet and each package's --max-warnings do the gating.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectWarnings, runOxlint } from './oxlint-warnings.mjs';
import {
  collectLargeFiles,
  discoverPackages,
  MAX_FILE_LINES,
} from './ratchet.mjs';

const TOP = 15;

// Collapsed so the PR comment stays a few lines long.
function table(summary, header, rows) {
  const body = [header, header.map(() => '---'), ...rows]
    .map(cells => `| ${cells.join(' | ')} |`)
    .join('\n');
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

export function sizeSection(large) {
  const files = Object.entries(large).sort(([, a], [, b]) => b - a);
  const excess = files.reduce((sum, [, n]) => sum + n - MAX_FILE_LINES, 0);
  return [
    '### File size',
    `${files.length} source files over ${MAX_FILE_LINES} lines, ${excess} lines over the limit in total.`,
    table(
      `Largest ${Math.min(TOP, files.length)}`,
      ['File', 'Lines'],
      files.slice(0, TOP).map(([file, n]) => [`\`${file}\``, n]),
    ),
  ].join('\n\n');
}

/** @param {Record<string, {limit: number|undefined, rules: Record<string, number>}>} byPackage */
export function lintSection(byPackage) {
  const packages = Object.keys(byPackage);
  const count = (pkg, rule) => byPackage[pkg].rules[rule] ?? 0;
  const total = pkg =>
    Object.values(byPackage[pkg].rules).reduce((a, b) => a + b, 0);
  const rules = [
    ...new Set(packages.flatMap(p => Object.keys(byPackage[p].rules))),
  ]
    .map(rule => [rule, packages.reduce((sum, p) => sum + count(p, rule), 0)])
    .sort(([, a], [, b]) => b - a);
  return [
    '### oxlint warnings',
    packages
      .map(p => `${p} ${total(p)}/${byPackage[p].limit ?? '?'}`)
      .join(', ') + ' (count/limit).',
    table(
      'By rule',
      ['Rule', ...packages, 'Total'],
      [
        ...rules.map(([rule, sum]) => [
          `\`${rule}\``,
          ...packages.map(p => count(p, rule)),
          sum,
        ]),
        ['**Total**', ...packages.map(total), ''],
        ['**Limit**', ...packages.map(p => byPackage[p].limit ?? ''), ''],
      ],
    ),
  ].join('\n\n');
}

/** The short version posted on the PR; the full report is on the run page. */
export function commentBody(large, byPackage, runUrl) {
  const sizes = Object.values(large);
  const excess = sizes.reduce((sum, n) => sum + n - MAX_FILE_LINES, 0);
  const lint = Object.entries(byPackage)
    .map(([pkg, { limit, rules }]) => {
      const total = Object.values(rules).reduce((a, b) => a + b, 0);
      return `${pkg} ${total}/${limit ?? '?'}`;
    })
    .join(', ');
  return [
    '## Code quality report',
    `- ${sizes.length} source files over ${MAX_FILE_LINES} lines, ${excess} lines over the limit in total`,
    `- oxlint warnings (count/limit): ${lint}`,
    ...(runUrl ? ['', `[Full report](${runUrl})`] : []),
  ].join('\n');
}

function lintPackage(dir) {
  const { scripts = {} } = JSON.parse(
    readFileSync(path.join(dir, 'package.json'), 'utf8'),
  );
  const limit = scripts.lint?.match(/--max-warnings (\d+)/)?.[1];
  const rules = {};
  for (const w of collectWarnings(runOxlint(dir, []).results)) {
    rules[w.ruleId] = (rules[w.ruleId] ?? 0) + 1;
  }
  return { limit: limit && Number(limit), rules };
}

function main() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const byPackage = {};
  for (const [name, dir] of discoverPackages(root)) {
    if (existsSync(path.join(dir, '.oxlintrc.json'))) {
      byPackage[name] = lintPackage(dir);
    }
  }
  const large = collectLargeFiles(root);
  console.log(
    ['## Code quality report', sizeSection(large), lintSection(byPackage)].join(
      '\n\n',
    ),
  );

  const commentPath = process.argv[process.argv.indexOf('--comment') + 1];
  if (process.argv.includes('--comment') && commentPath) {
    const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
    const runUrl =
      GITHUB_RUN_ID &&
      `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
    writeFileSync(commentPath, commentBody(large, byPackage, runUrl) + '\n');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
