---
'@hyperdx/common-utils': patch
---

perf: find the most frequent Map keys with topKWeighted instead of grouping
every text index token

On tables whose Map keys include unique values (IDs, hashes), the keys text
index holds millions of distinct tokens, and grouping them all took seconds and
many GiB of memory. Keys now come from `topKWeighted`, which uses a fixed amount
of memory. When the keys fit in its table (3 × the key limit), it picks the
same keys as before.
