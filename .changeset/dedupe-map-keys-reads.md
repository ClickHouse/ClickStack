---
'@hyperdx/common-utils': patch
---

perf: share one Map key read between concurrent callers

Two Map key lookups with the same arguments, made while the first was still
running, each sent their own query. On large tables a Map key text index read
can use several GiB of memory. Concurrent lookups for the same keys now share
one query.
