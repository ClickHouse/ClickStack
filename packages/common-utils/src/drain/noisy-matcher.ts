import { tokenizeContent } from './drain';
import {
  createPatternMasker,
  DENOISE_NOISE_THRESHOLD,
  flattenBody,
} from './mine-patterns';

const PATTERN_WILDCARD = '<*>';

/**
 * The patterns to remove when denoising: those matching more than
 * `DENOISE_NOISE_THRESHOLD` of the sample, most frequent first.
 */
export function selectNoisyPatterns<T>(
  patterns: T[],
  getCount: (pattern: T) => number,
  sampleSize: number,
): T[] {
  if (sampleSize <= 0) return [];
  return patterns
    .filter(p => getCount(p) / sampleSize > DENOISE_NOISE_THRESHOLD)
    .sort((a, b) => getCount(b) - getCount(a));
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
 * body splits into the same tokens the templates were built from
 * (`PATTERN_EXTRA_DELIMITERS` for `minePatterns`). Likewise set `masked` when
 * the templates come from `minePatterns` (default masks), so the body is
 * masked the same way; drain3's default config has no masks.
 */
export function buildNoisyBodyMatcher(
  templates: string[],
  noisyTemplates: Set<string>,
  options?: { extraDelimiters?: string[]; masked?: boolean },
): (body: string) => boolean {
  const extraDelimiters = options?.extraDelimiters ?? [];
  const candidates = templates.map(template => {
    const tokens = tokenizeContent(template, []);
    return {
      tokens,
      wildcards: tokens.filter(t => t === PATTERN_WILDCARD).length,
      noisy: noisyTemplates.has(template),
    };
  });
  const masker = options?.masked ? createPatternMasker() : undefined;
  const maskTokens =
    masker?.maskNames.map(n => masker.maskPrefix + n + masker.maskSuffix) ?? [];
  return body => {
    const flat = flattenBody(body);
    const tokens = tokenizeContent(
      masker ? masker.mask(flat) : flat,
      extraDelimiters,
      maskTokens,
    );
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
