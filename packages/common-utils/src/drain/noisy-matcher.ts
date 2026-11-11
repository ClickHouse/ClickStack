import {
  DENOISE_COVERAGE,
  DENOISE_MIN_PATTERN_SHARE,
  flattenBody,
} from './mine-patterns';

const PATTERN_WILDCARD = '<*>';

/**
 * The patterns to remove when denoising: most frequent first, until they
 * cover `DENOISE_COVERAGE` of the sample, skipping any pattern under
 * `DENOISE_MIN_PATTERN_SHARE`. The pattern that crosses the coverage line is
 * included.
 */
export function selectNoisyPatterns<T>(
  patterns: T[],
  getCount: (pattern: T) => number,
  sampleSize: number,
): T[] {
  if (sampleSize <= 0) return [];
  const noisy: T[] = [];
  let covered = 0;
  const sorted = [...patterns].sort((a, b) => getCount(b) - getCount(a));
  for (const p of sorted) {
    const count = getCount(p);
    if (covered / sampleSize >= DENOISE_COVERAGE) break;
    if (count / sampleSize < DENOISE_MIN_PATTERN_SHARE) break;
    noisy.push(p);
    covered += count;
  }
  return noisy;
}

/**
 * Return a predicate that is true when the most specific template a body
 * fits (fewest <*>) is noisy. Fitting means same token count, same literal
 * tokens, any token at each <*>. Taking the most specific fit keeps rows of
 * a rare `user login` cluster when a broad `<*> <*>` cluster is noisy; ties
 * go to the noisy template. Re-running Drain's `match` instead can land a
 * member on a different same-length cluster than the one it was counted in.
 *
 * `extraDelimiters` must be the ones the miner was configured with, so the
 * body splits into the same tokens the templates were built from.
 */
export function buildNoisyBodyMatcher(
  templates: string[],
  noisyTemplates: Set<string>,
  options?: { extraDelimiters?: string[] },
): (body: string) => boolean {
  const extraDelimiters = options?.extraDelimiters ?? [];
  const candidates = templates.map(template => {
    const tokens = tokenize(template, []);
    return {
      tokens,
      wildcards: tokens.filter(t => t === PATTERN_WILDCARD).length,
      noisy: noisyTemplates.has(template),
    };
  });
  return body => {
    const tokens = tokenize(flattenBody(body), extraDelimiters);
    let best: (typeof candidates)[number] | undefined;
    for (const c of candidates) {
      const fits =
        c.tokens.length === tokens.length &&
        c.tokens.every(
          (tok, i) => tok === PATTERN_WILDCARD || tok === tokens.at(i),
        );
      if (!fits) continue;
      if (
        best == null ||
        c.wildcards < best.wildcards ||
        (c.wildcards === best.wildcards && c.noisy)
      ) {
        best = c;
      }
    }
    return best?.noisy ?? false;
  };
}

// Mirrors Drain's tokenizer: delimiters become spaces, then split(/\s+/).
// Templates are already space-joined tokens, and splitting one on a
// delimiter would break up `<*>`.
function tokenize(text: string, extraDelimiters: string[]): string[] {
  let c = text.trim();
  for (const delimiter of extraDelimiters) {
    c = c.split(delimiter).join(' ');
  }
  c = c.trim();
  return c === '' ? [] : c.split(/\s+/);
}
