---
'@hyperdx/otel-collector': patch
---

perf: use 8,192-token text index dictionary blocks on the seeded tables

On ClickHouse 26.6 and later, the collector's schema migration now sets
`text_index_dictionary_block_size = 8192` (the default is 512) on `otel_logs`,
`otel_traces` and `hyperdx_sessions`, with `ALTER TABLE … MODIFY SETTING` after
the seed. Each part's text index sparse index is 16x smaller. Reading filter
values with `mergeTreeTextIndex()` loads that index for every part on every
read, and on a 537M-row table 4,096-token blocks already made those reads about
10x cheaper per part, made searches for a rare attribute value 3-7x faster, and
made searches for a common value 10-30% faster.

Because it's an `ALTER`, existing installs get it too: new parts use 8,192-token
blocks, and existing parts keep theirs until they're merged. A table that
already sets `text_index_dictionary_block_size` is left alone, and operators who
manage these tables themselves can turn the change off with
`HYPERDX_OTEL_EXPORTER_SET_TEXT_INDEX_BLOCK_SIZE=false`. ClickHouse 26.2–26.5
doesn't have the setting, so those servers keep 512-token blocks.
