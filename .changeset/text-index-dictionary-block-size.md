---
'@hyperdx/otel-collector': patch
---

perf: use 4,096-token dictionary blocks for the key=value text indexes in the
logs and traces seed schemas

`idx_res_attr_items`, `idx_scope_attr_items` and `idx_log_attr_items` on
`otel_logs`, and `idx_res_attr_items` and `idx_span_attr_items` on
`otel_traces`, now set `dictionary_block_size = 4096` (the default is 512).
Each part's sparse index is about 8x smaller, which cuts the per-part cost of
reading filter values from these indexes about 10x on large parts. Lookups in
these indexes decode up to 8x more tokens per block. Only new installs get the
new schema; existing tables keep their indexes until they are recreated, or
the indexes are cleared and materialized again.
