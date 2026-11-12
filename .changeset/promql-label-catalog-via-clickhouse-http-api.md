---
'@hyperdx/api': patch
---

feat: read the MCP PromQL label catalog from ClickHouse's Prometheus HTTP API

`describe_source` on a ClickHouse-backed PromQL source now lists label and metric names through the `prometheus_api_v1` handler on ClickHouse 26.9+, and falls back to SQL on older servers, servers without the handler, and sources set to `table-function`.
