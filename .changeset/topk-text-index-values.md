---
'@hyperdx/common-utils': patch
---

perf: show the most frequent text index values, in batches of 10 keys

"All values" lookups that read a text index (Map key=value indexes and text
indexes on plain columns) used `groupUniqArray(limit)`, which keeps the
alphabetically first tokens it reads. They now use `topKWeighted(limit)`
weighted by each token's row count, so a capped list holds the most common
values, most common first. These lookups also run in parallel batches of at
most 10 keys instead of 100, so a key with very many values delays only its own
batch.
