---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix: use the Map KV items index for ad hoc and dashboard filters on Map keys.
These filters render `toString(Map['k']) = 'v'`, which the `has(<items>, ...)`
rewrite previously skipped, so the query decoded the whole Map for every row.
