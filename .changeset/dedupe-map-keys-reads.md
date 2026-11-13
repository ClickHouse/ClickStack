---
'@hyperdx/common-utils': patch
---

perf: share one Map key read between concurrent callers

The search page's filter panel, search bar and group-by each load the same Map
keys when the page opens. Each sent its own text index read, which on large
tables can use several GiB of memory. Concurrent requests for the same keys now
share one query.
