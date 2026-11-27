---
'@hyperdx/app': patch
---

perf: row lookups read from the ClickHouse filesystem cache when the data is
already there, without filling the cache with data nothing else is likely to
read.
