---
'@hyperdx/common-utils': patch
---

feat: show the most frequent filter values read from text indexes

"All values" lookups that read a text index (Map key=value indexes and text
indexes on plain columns) used `groupUniqArray(limit)`, which keeps the
alphabetically first tokens it reads. They now use `topKWeighted(limit)`
weighted by each token's row count, so a capped list holds the most common
values, most common first. This costs more CPU per token than before.
