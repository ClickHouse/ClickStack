---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

feat: add the SQL query dashboard filter type to the dashboard schema

A `SQL_QUERY` filter stores a ClickHouse connection and a SQL template whose first column fills the filter's dropdown. It is variable-only. Validation flags templates that use `$__sourceTable` or `$__filters`, or whose macros and variable references can't expand. The filter is not yet exposed through the external API or MCP, and has no editor or values lookup yet.
