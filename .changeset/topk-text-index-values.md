---
'@hyperdx/common-utils': patch
---

perf: read large-block Map text index values per key, most frequent first

"All values" lookups on Map key=value text indexes with large dictionary blocks
(4096 or more, e.g. `dictionary_block_size = 8192` as the seed schemas now use)
now read each key separately, in parallel queries of at most 10 keys, and stop
after 20,000 tokens per key, so a key with a value per row (request IDs, UUIDs)
can't hold up the others. Values come from `topKWeighted(limit)` weighted by
each token's row count, so a capped list holds the most common values, most
common first.

Indexes with smaller blocks, including ClickHouse's default of 512, keep the
previous query: one read for all keys, the alphabetically first values, and the
`max_rows_to_read` cap. Every read loads each part's sparse index, which is
large with small blocks, so one read per key would multiply that cost. The block
size comes from the index definition, then the table's
`text_index_dictionary_block_size`, then the server's.

Text indexes on plain columns now return the most frequent values with
`topKWeighted`, in parallel queries of at most 10 columns.
