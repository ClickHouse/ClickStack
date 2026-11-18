---
'@hyperdx/app': patch
---

fix: keep JSON-column filter keys in JSON form when another filter is added

Adding a second filter, or clicking "Load more" on a filter, no longer rewrites
an earlier filter on a key inside a native JSON column to `col['key']`, which
ClickHouse rejects (`Illegal type Dynamic of argument of function in`, or
`First argument for function 'arrayElement' must be array, got 'JSON'` on older
versions).
