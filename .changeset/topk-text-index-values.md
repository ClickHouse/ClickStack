---
'@hyperdx/common-utils': patch
---

perf: show the most frequent text index values, and read large-block Map
indexes per key

"All values" lookups that read a text index (Map key=value indexes and text
indexes on plain columns) kept the alphabetically first values. Values now come
from `topKWeighted(limit)` weighted by each token's row count, so a capped list
holds the most common values, most common first.

Map key=value indexes with large dictionary blocks (4096 or more, e.g.
`dictionary_block_size = 8192` as the seed schemas now use) read each key
separately, in parallel queries of at most 10 keys, and stop after 20,000 tokens
per key, so a key with a value per row (request IDs, UUIDs) can't hold up the
others. Indexes with smaller blocks, including ClickHouse's default of 512, keep
one read for all keys as before: every read loads each part's sparse index,
which is large with small blocks, so one read per key would multiply that cost.
The block size comes from the index definition, then the table's
`text_index_dictionary_block_size`, then the server's. Text indexes on plain
columns run in parallel queries of at most 10 columns.
