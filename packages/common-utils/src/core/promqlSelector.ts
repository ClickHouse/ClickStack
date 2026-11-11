import { parser } from '@prometheus-io/lezer-promql';

type SyntaxNode = ReturnType<typeof parser.parse>['topNode'];

/**
 * The metric a series selector is limited to: `name`, `name{...}`,
 * `{"name", ...}`, or `{__name__="name", ...}` (label name quoted or not).
 * Undefined when the selector may match more than one metric, isn't a single
 * plain selector, or doesn't parse.
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

  const text = (node: SyntaxNode | null | undefined) =>
    node ? selector.slice(node.from, node.to) : undefined;
  // Values with escapes would need unquoting; `null` makes the caller fall back.
  const unquote = (literal: SyntaxNode | null | undefined) => {
    const quoted = text(literal);
    if (quoted == null || quoted.includes('\\')) return null;
    return quoted.slice(1, -1);
  };

  const names: (string | null)[] = [];
  const identifier = vectorSelector.getChild('Identifier');
  if (identifier) names.push(text(identifier) ?? null);

  const matchers = vectorSelector.getChild('LabelMatchers');
  for (let m = matchers?.firstChild; m; m = m.nextSibling) {
    if (m.name === 'QuotedLabelName') {
      names.push(unquote(m.getChild('StringLiteral')));
      continue;
    }
    const label =
      m.name === 'UnquotedLabelMatcher'
        ? text(m.getChild('LabelName'))
        : m.name === 'QuotedLabelMatcher'
          ? unquote(m.getChild('QuotedLabelName')?.getChild('StringLiteral'))
          : undefined;
    if (
      label === '__name__' &&
      m.getChild('MatchOp')?.firstChild?.name === 'EqlSingle'
    ) {
      names.push(unquote(m.getChild('StringLiteral')));
    }
  }

  const unique = new Set(names);
  const [name] = unique;
  return unique.size === 1 && name != null ? name : undefined;
}
