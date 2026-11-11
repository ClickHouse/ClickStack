---
'@hyperdx/api': minor
---

chore: upgrade bundled ClickHouse to 26.10.3.7

The all-in-one image and the Docker Compose files now use
`clickhouse/clickhouse-server:26.10.3.7-alpine`. New TimeSeries tables default
to schema version 8, which keeps each series' time range in a separate inner
table; existing tables keep their layout. `system.metric_log` switches to the
bucketed schema, and rows from before the upgrade move to `system.metric_log_0`.
