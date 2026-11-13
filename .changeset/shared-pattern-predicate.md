---
'@hyperdx/common-utils': minor
---

feat: share the Event Patterns drill-down predicate

`templateToRegex` and `buildPatternPredicate`, which the MCP server uses to
build the `clickstack_event_patterns` drill-down filter, are now in
`@hyperdx/common-utils/dist/drain`. New options match templates mined with extra
delimiters (`extraDelimiters`) or by Python Drain3 (`whitespace: 'python'`), and
`parsePatternPredicate` reads a predicate back into its value expression and
template. Without options the output is the same as the MCP server's.
