---
'@hyperdx/common-utils': patch
---

perf: read each key's text index values separately, and show the most
frequent ones

"All values" lookups that read a text index (Map key=value indexes and text
indexes on plain columns) read every token of every requested key, capped at
`max_rows_to_read` for the whole query. One key with a value per row (request
IDs, UUIDs) slowed the whole query down, and because the index is read in
sorted order, the cap left keys that sort after it with no values. Each key now
has its own query branch that reads at most 100,000 tokens, and there is no
whole-query row cap. Values come from `topKWeighted(limit)` weighted by each
token's row count, so a capped list holds the most common values, most common
first. For keys with more distinct values than the token cap, they are the most
common among the alphabetically first ones.
