---
'@hyperdx/api': minor
---

feat: Create, read, and update ad hoc dashboard filters through the external API

`/api/v2/dashboards` now accepts and returns `ADHOC` filters, with SQL and
PromQL source types, and their `adhoc` entries in `savedFilterValues`. Each
filter's sources must exist and be a kind its `sourceType` supports. MCP still
hides ad hoc filters.
