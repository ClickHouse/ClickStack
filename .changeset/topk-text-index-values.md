---
'@hyperdx/common-utils': patch
---

perf: read text index values in batches of 10 keys, most frequent first

"All values" lookups that read a text index (Map key=value indexes and text
indexes on plain columns) read every token of up to 100 keys in one query, so
one key with a value per row (request IDs, UUIDs) slowed every other key down.
These lookups now run in parallel queries of at most 10 keys, and keep at most
20,000 tokens per key. Values come from `topKWeighted(limit)` weighted by each
token's row count, so a capped list holds the most common values, most common
first.

Map key=value indexes with large dictionary blocks (4096 or more, e.g.
`dictionary_block_size = 8192` as the seed schemas now use) read each key
separately, so a high-cardinality key stops after its 20,000 tokens. Indexes with
smaller blocks, including ClickHouse's default of 512, read all keys of a batch
in one pass: every read loads each part's sparse index, which is large with small
blocks, so one read per key would multiply that cost. The block size comes from
the index definition, then the table's `text_index_dictionary_block_size`, then
the server's.
