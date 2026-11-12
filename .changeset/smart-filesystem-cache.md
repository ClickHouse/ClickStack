---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat: New per-source setting "Skip filesystem cache writes". Charts and searches over a time range longer than the chosen threshold set `read_from_filesystem_cache_if_exists_otherwise_bypass_cache = 1`, so long scans don't evict recently cached data. Off by default.
