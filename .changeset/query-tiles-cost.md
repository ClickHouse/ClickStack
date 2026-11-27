---
'@hyperdx/api': patch
---

feat(mcp): `clickstack_query_tiles` reports each tile's wall time (`elapsedMs`),
and rows and bytes read for builder and SQL tiles; PromQL results from
`clickstack_promql` and `clickstack_query_tile` carry `elapsedMs`
