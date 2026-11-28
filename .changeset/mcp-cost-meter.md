---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

feat(mcp): `clickstack_event_patterns`, `clickstack_emerging_signals` and
`clickstack_describe_source` return `statistics` (`elapsed`, `rows_read`,
`bytes_read`, `queries`), summed over the ClickHouse queries of the call. A
query cost meter in the node ClickHouse client (`withQueryCost`) adds up the
statistics of each JSON result.
