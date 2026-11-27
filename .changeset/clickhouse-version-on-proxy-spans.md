---
'@hyperdx/api': patch
---

feat: record the ClickHouse server version on ClickHouse proxy spans, as
`hyperdx.clickhouse_proxy.clickhouse.version`, so query errors and latency can
be compared across ClickHouse upgrades.
