---
'@hyperdx/app': patch
---

fix: keep JSON-column filter keys in JSON form when another filter is added

Adding a second filter no longer rewrites an earlier filter on a key inside a
native JSON column to `col['key']`, which ClickHouse rejects with
`Code 43: First argument for function 'arrayElement' must be array, got 'JSON'`.
