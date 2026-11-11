---
'@hyperdx/common-utils': minor
'@hyperdx/app': patch
---

feat: show the most frequent filter values instead of an arbitrary subset

Value lookups that read table rows (the filter panel's default mode, dashboard
and Kubernetes filters, and the raw-table fallback for all values) used
`groupUniqArray(limit)`, which keeps whichever values it reads first, over a
sample of the first `max_rows_to_read` rows. They now run `topK(limit)` over
the whole time range, so a capped list holds the most common values in the
range, most common first. Missing JSON paths and Map keys no longer take a
slot. These lookups now read every row in the range and use more CPU per row.

`getKeyValues` and `getKeyValuesWithMVs` no longer take `disableRowLimit`.
