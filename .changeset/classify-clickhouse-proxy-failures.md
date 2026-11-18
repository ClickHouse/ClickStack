---
'@hyperdx/api': patch
---

feat: Classify failed ClickHouse proxy requests on the server span and the
`clickhouse_proxy.query` SLI (`error_category`), including errors ClickHouse
writes after a 200 response. The span also records the upstream status, the
ClickHouse error code and type, and the body of upstream errors that carry no
ClickHouse code.
