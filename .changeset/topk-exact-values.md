---
'@hyperdx/common-utils': patch
---

feat: show the most frequent filter values instead of an arbitrary subset

Value lookups that read table rows (the filter panel's default mode, dashboard
and Kubernetes filters, and the raw-table fallback for all values) used
`groupUniqArray(limit)`, which keeps whichever values it reads first. They now
use `topK(limit)`, so a capped list holds the most common values, most common
first. Missing JSON paths and Map keys no longer take a slot. This costs more
CPU per row than before.
