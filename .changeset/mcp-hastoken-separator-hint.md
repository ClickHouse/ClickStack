---
'@hyperdx/api': patch
---

fix(mcp): explain hasToken() separator errors in query tools

When a SQL filter calls `hasToken()` with a needle that contains `_`, `-`, `.`,
`@`, `:` or spaces, ClickHouse fails with "Needle must not contain whitespace or
separator characters". MCP query tools now append a hint pointing to a Lucene
term or `hasAllTokens()`/`LIKE`, and the `where` description warns about it.
