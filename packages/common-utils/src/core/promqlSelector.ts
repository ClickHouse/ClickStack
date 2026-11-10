import { parser } from '@prometheus-io/lezer-promql';

/**
 * The metric a series selector is limited to: `name`, `name{...}`, or
 * `{__name__="name", ...}`. Undefined when the selector may match more than
 * one metric, isn't a single plain selector, or doesn't parse.
 */
export function promqlSelectorMetricName(selector: string): string | undefined {
  const tree = parser.parse(selector);
  let parseError = false;
  tree.iterate({
    enter: node => {
      if (node.type.isError) parseError = true;
    },
  });
  const vectorSelector = tree.topNode.firstChild;
  if (parseError || vectorSelector?.name !== 'VectorSelector') return;

  const identifier = vectorSelector.getChild('Identifier');
  if (identifier) return selector.slice(identifier.from, identifier.to);

  const matchers =
    vectorSelector
      .getChild('LabelMatchers')
      ?.getChildren('UnquotedLabelMatcher') ?? [];
  for (const matcher of matchers) {
    const name = matcher.getChild('LabelName');
    const op = matcher.getChild('MatchOp')?.firstChild;
    const value = matcher.getChild('StringLiteral');
    if (
      name &&
      value &&
      op?.name === 'EqlSingle' &&
      selector.slice(name.from, name.to) === '__name__'
    ) {
      // Values with escapes would need unquoting; fall back instead.
      const text = selector.slice(value.from + 1, value.to - 1);
      return text.includes('\\') ? undefined : text;
    }
  }
}
