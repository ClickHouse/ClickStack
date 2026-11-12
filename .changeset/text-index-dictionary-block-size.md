---
'@hyperdx/otel-collector': patch
---

perf: use 8,192-token dictionary blocks for every text index in the seed
schemas

Every text index on `otel_logs`, `otel_traces` and `hyperdx_sessions` now sets
`dictionary_block_size = 8192` (the default is 512). Each part's sparse index
is 16x smaller. Reading filter values with `mergeTreeTextIndex()` loads that
index for every part on every read, and on a 537M-row table 4,096-token blocks
already made those reads about 10x cheaper per part, made searches for a rare
attribute value 3-7x faster, and made searches for a common value 10-30%
faster. The setting is a per-index argument rather than the table setting
`text_index_dictionary_block_size`, which ClickHouse only accepts from 26.6.

Only new installs get the new schema. Existing tables keep their indexes until
the indexes are cleared and materialized again.
