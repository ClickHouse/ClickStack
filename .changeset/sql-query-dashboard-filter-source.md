---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

feat: let SQL query dashboard filters use an optional source

A SQL query filter can now pick a source on its connection. With one, its SQL can use `$__sourceTable` and `$__filters`, which applies the dashboard's filter selections for that source, the same way raw SQL tiles do. The external API and MCP read and write it as `sourceId`.
