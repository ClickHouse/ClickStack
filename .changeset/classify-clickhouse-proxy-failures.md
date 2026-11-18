---
'@hyperdx/api': patch
---

feat: Classify failed ClickHouse proxy requests on the server span and the
`clickhouse_proxy.query` SLI (`error_category`), including errors ClickHouse
writes after a 200 response. The span also carries the upstream status, the
ClickHouse error code and the error message.
