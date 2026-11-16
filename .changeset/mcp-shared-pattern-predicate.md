---
'@hyperdx/api': patch
---

refactor: the MCP `clickstack_event_patterns` tool builds its drill-down
`whereSnippet` with the shared pattern predicate from `@hyperdx/common-utils`
instead of its own copy. The snippet is unchanged.
