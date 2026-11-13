---
'@hyperdx/common-utils': minor
---

feat: share the Event Patterns drill-down predicate

`templateToRegex` and `buildPatternPredicate`, which the MCP server uses to
build the `clickstack_event_patterns` drill-down filter, are now in
`@hyperdx/common-utils/dist/drain`. A new `extraDelimiters` option matches
templates mined with extra delimiters, and `parsePatternPredicate` reads a
predicate back into its value expression and template. Without the option the
output is the same as the MCP server's.
