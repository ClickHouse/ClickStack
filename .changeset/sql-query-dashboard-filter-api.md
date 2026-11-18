---
'@hyperdx/api': patch
---

feat: accept SQL query dashboard filters in the API, external API, and MCP

Saving a dashboard now rejects a `SQL_QUERY` filter whose connection doesn't belong to the team. The external API and MCP read and write the filter with a `connectionId`, and MCP warns about unknown variables and source-only macros in its SQL.
