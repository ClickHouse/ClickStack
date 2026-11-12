---
'@hyperdx/common-utils': patch
---

perf: read text index values per key, in batches of 10 keys, most frequent
first

"All values" lookups that read a text index (Map key=value indexes and text
indexes on plain columns) read every token of up to 100 keys in one query,
capped at `max_rows_to_read` for the whole query. One key with a value per row
(request IDs, UUIDs) slowed every other key down, and because the index is read
in sorted order, the cap left keys that sort after it with no values. These
lookups now run in parallel queries of at most 10 keys, each key in its own
branch that reads at most 20,000 tokens, with no whole-query row cap. Values
come from `topKWeighted(limit)` weighted by each token's row count, so a capped
list holds the most common values, most common first.

Each branch reads every part's text index once, so this is fastest when the
index uses large dictionary blocks (e.g. `text_index_dictionary_block_size =
4096`).
