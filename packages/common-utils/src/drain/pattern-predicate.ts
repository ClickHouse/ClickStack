import { escapeSqlString } from '@/core/utils';

const PATTERN_WILDCARD = '<*>';

/**
 * Templates longer than this get no predicate: the regex (and the SQL that
 * embeds it) would be unwieldy, and very long templates are usually a
 * single unparameterized payload rather than a reusable shape.
 */
export const MAX_PREDICATE_TEMPLATE_LENGTH = 4000;

export type PatternRegexOptions = {
  /**
   * The extra delimiters the miner was configured with, one character each.
   * Drain turns each one into a space before splitting, so they separate
   * tokens like whitespace.
   */
  extraDelimiters?: string[];
  /**
   * The whitespace the miner split on: JavaScript's `\s` for the TypeScript
   * Drain port (the default), or Python's `str.split()` for Drain3.
   */
  whitespace?: 'js' | 'python';
};

// The TypeScript Drain port tokenizes with JS `\s`, which includes Unicode
// spaces and BOM; RE2's `\s` is ASCII-only. JS `\s` = RE2 `\s` + \v + \pZ
// (Zs/Zl/Zp) + BOM. `\pZ` keeps the snippet short; spelling out the code
// points repeats ~100 chars between every token.
const JS_WHITESPACE = '\\s\\x{0B}\\pZ\\x{FEFF}';
// Python's `str.split()`, which Drain3 uses: RE2 `\s` + \v + the separators
// \x1C-\x1F + NEL + \pZ, and no BOM.
const PYTHON_WHITESPACE = '\\s\\x{0B}\\x{1C}-\\x{1F}\\x{85}\\pZ';

function escapeRe2Literal(token: string): string {
  return token.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

// The characters that are special inside a character class. `[` can open a
// POSIX class such as `[:alpha:]` in RE2.
function escapeRe2ClassChars(chars: string): string {
  return chars.replace(/[\\\]^[-]/g, '\\$&');
}

/** The ASCII punctuation: exactly RE2's `[:punct:]`, and Python's `string.punctuation`. */
export const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

function separatorClass(options?: PatternRegexOptions): string {
  const delimiters = options?.extraDelimiters ?? [];
  // Drain splits on each delimiter as a whole string, which a character class
  // can't express for one longer than a character.
  if (delimiters.some(d => [...d].length !== 1)) {
    throw new Error('extraDelimiters must be single characters');
  }
  const whitespace =
    options?.whitespace === 'python' ? PYTHON_WHITESPACE : JS_WHITESPACE;
  // The class repeats between every token, so spelling out all 32 ASCII
  // punctuation characters (most of which need URL encoding) makes the
  // filter too long to keep in a URL.
  const allPunctuation = [...ASCII_PUNCTUATION].every(c =>
    delimiters.includes(c),
  );
  const rest = allPunctuation
    ? delimiters.filter(c => !ASCII_PUNCTUATION.includes(c))
    : delimiters;
  return (
    whitespace +
    (allPunctuation ? '[:punct:]' : '') +
    escapeRe2ClassChars(rest.join(''))
  );
}

function tokensOf(template: string): string[] {
  return template.split(/\s+/).filter(t => t.length > 0);
}

/** Anchored RE2 regex that a value matches when it fits the Drain template. */
export function templateToRegex(
  template: string,
  options?: PatternRegexOptions,
): string {
  const separators = separatorClass(options);
  const separator = `[${separators}]`;
  const body = tokensOf(template)
    .map(t =>
      t === PATTERN_WILDCARD ? `[^${separators}]+` : escapeRe2Literal(t),
    )
    .join(`${separator}+`);
  return `^${separator}*${body}${separator}*$`;
}

/**
 * SQL predicate selecting events whose `valueExpression` fits the template,
 * or null when the template is too long to turn into a predicate.
 */
export function buildPatternPredicate(
  valueExpression: string,
  template: string,
  options?: PatternRegexOptions,
): string | null {
  if (template.length > MAX_PREDICATE_TEMPLATE_LENGTH) return null;
  return `match(${valueExpression}, '${escapeSqlString(templateToRegex(template, options))}')`;
}

// Regex over a value whose separator runs were replaced by single spaces.
function compactRegex(template: string): string {
  const body = tokensOf(template)
    .map(t => (t === PATTERN_WILDCARD ? '[^ ]+' : escapeRe2Literal(t)))
    .join(' ');
  return `^ ?${body} ?$`;
}

/**
 * The same match as buildPatternPredicate in much shorter SQL: separator runs
 * in the value become single spaces first, so the separator class appears
 * once instead of between every token. For conditions that are stored or
 * shared, such as search filters kept in the URL.
 */
export function buildCompactPatternPredicate(
  valueExpression: string,
  template: string,
  options?: PatternRegexOptions,
): string | null {
  if (template.length > MAX_PREDICATE_TEMPLATE_LENGTH) return null;
  const separatorRun = `[${separatorClass(options)}]+`;
  const normalized = `replaceRegexpAll(${valueExpression}, '${escapeSqlString(separatorRun)}', ' ')`;
  return `match(${normalized}, '${escapeSqlString(compactRegex(template))}')`;
}

const unescapeSql = (literal: string) =>
  literal.replace(/''/g, "'").replace(/\\\\/g, '\\');
const unescapeRe2Literal = (token: string) => token.replace(/\\(.)/g, '$1');

function parseCompactPredicate(
  condition: string,
  options?: PatternRegexOptions,
): { valueExpression: string; template: string } | null {
  const call =
    /^match\(replaceRegexpAll\((.+), '((?:[^'\\]|\\\\|'')*)', ' '\), '((?:[^'\\]|\\\\|'')*)'\)$/s.exec(
      condition,
    );
  if (call == null) return null;
  const [, valueExpression, separatorLiteral, regexLiteral] = call;
  if (unescapeSql(separatorLiteral) !== `[${separatorClass(options)}]+`) {
    return null;
  }
  const regex = unescapeSql(regexLiteral);
  if (!regex.startsWith('^ ?') || !regex.endsWith(' ?$')) return null;
  const inner = regex.slice('^ ?'.length, regex.length - ' ?$'.length);
  // The wildcard `[^ ]+` itself contains a space, so match tokens rather
  // than splitting on spaces.
  const template = (inner.match(/\[\^ \]\+|[^ ]+/g) ?? [])
    .map(part =>
      part === '[^ ]+' ? PATTERN_WILDCARD : unescapeRe2Literal(part),
    )
    .join(' ');
  return compactRegex(template) === regex
    ? { valueExpression, template }
    : null;
}

/**
 * Reverse of buildPatternPredicate and buildCompactPatternPredicate: the
 * value expression and template of a predicate either built with the same
 * options, or null for any other condition.
 */
export function parsePatternPredicate(
  condition: string,
  options?: PatternRegexOptions,
): { valueExpression: string; template: string } | null {
  const compact = parseCompactPredicate(condition, options);
  if (compact != null) return compact;
  const call = /^match\((.+), '((?:[^'\\]|\\\\|'')*)'\)$/s.exec(condition);
  if (call == null) return null;
  const [, valueExpression, literal] = call;
  const regex = unescapeSql(literal);

  const separators = separatorClass(options);
  const separator = `[${separators}]`;
  const prefix = `^${separator}*`;
  const suffix = `${separator}*$`;
  if (!regex.startsWith(prefix) || !regex.endsWith(suffix)) return null;
  const template = regex
    .slice(prefix.length, regex.length - suffix.length)
    .split(`${separator}+`)
    .map(part =>
      part === `[^${separators}]+`
        ? PATTERN_WILDCARD
        : unescapeRe2Literal(part),
    )
    .join(' ');
  // Only what this module builds counts, so a hand-written match() isn't
  // mistaken for a pattern.
  return templateToRegex(template, options) === regex
    ? { valueExpression, template }
    : null;
}
