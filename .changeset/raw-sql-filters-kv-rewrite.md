---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix: use the Map KV items index for SQL filters expanded by `$__filters` in raw
SQL tiles and SQL query dashboard filters, as Lucene filters already do. As with
Lucene filters, `$__filters` must be placed where the source table's columns are
visible, since the rewrite references the KV items ALIAS column.
