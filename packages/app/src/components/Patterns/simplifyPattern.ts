// A run of wildcards joined only by spaces and punctuation, plus a closing
// quote right after it.
const WILDCARD_RUN = /<\*>(?:[^A-Za-z0-9<]*<\*>)*("?)/g;

/**
 * A pattern template shortened for display: each run of wildcards, such as
 * `<*>.<*>_<*>=<*> <*>` (key=value pairs Drain fully generalized), becomes a
 * single `…`.
 */
export function simplifyPattern(pattern: string): string {
  return pattern
    .replace(WILDCARD_RUN, (run, closingQuote: string) => {
      const innerQuotes = (run.match(/"/g)?.length ?? 0) - closingQuote.length;
      // An odd count means the run opened a quote, so its closing quote
      // goes with it. Otherwise the closing quote belongs to the text.
      return innerQuotes % 2 === 1 ? '…' : `…${closingQuote}`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
