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
   * The extra delimiters the miner was configured with. Drain turns each one
   * into a space before splitting, so they separate tokens like whitespace.
   */
  extraDelimiters?: string[];
};

// Drain tokenizes with JS `\s`, which includes Unicode spaces and BOM; RE2's
// `\s` is ASCII-only. JS `\s` = RE2 `\s` + \v + \pZ (Zs/Zl/Zp) + BOM. `\pZ`
// keeps the snippet short; spelling out the code points repeats ~100 chars
// between every token.
const JS_WHITESPACE = '\\s\\x{0B}\\pZ\\x{FEFF}';

function escapeRe2Literal(token: string): string {
  return token.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

// The characters that are special inside a character class. `[` can open a
// POSIX class such as `[:alpha:]` in RE2.
function escapeRe2ClassChars(chars: string): string {
  return chars.replace(/[\\\]^[-]/g, '\\$&');
}

// Exactly RE2's `[:punct:]`, and Python's string.punctuation.
const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

function separatorClass(options?: PatternRegexOptions): string {
  const delimiters = options?.extraDelimiters ?? [];
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
    JS_WHITESPACE +
    (allPunctuation ? '[:punct:]' : '') +
    escapeRe2ClassChars(rest.join(''))
  );
}

/** Anchored RE2 regex that a value matches when it fits the Drain template. */
export function templateToRegex(
  template: string,
  options?: PatternRegexOptions,
): string {
  const separators = separatorClass(options);
  const separator = `[${separators}]`;
  const tokens = template.split(/\s+/).filter(t => t.length > 0);
  const body = tokens
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

/**
 * Reverse of buildPatternPredicate: the value expression and template of a
 * predicate it built with the same options, or null for any other condition.
 */
export function parsePatternPredicate(
  condition: string,
  options?: PatternRegexOptions,
): { valueExpression: string; template: string } | null {
  const call = /^match\((.+), '((?:[^'\\]|\\\\|'')*)'\)$/s.exec(condition);
  if (call == null) return null;
  const [, valueExpression, literal] = call;
  const regex = literal.replace(/''/g, "'").replace(/\\\\/g, '\\');

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
        : part.replace(/\\(.)/g, '$1'),
    )
    .join(' ');
  // Only what this module builds counts, so a hand-written match() isn't
  // mistaken for a pattern.
  return templateToRegex(template, options) === regex
    ? { valueExpression, template }
    : null;
}
