---
'@hyperdx/api': minor
'@hyperdx/common-utils': minor
---

feat: serve PromQL label lookups from ClickHouse's Prometheus HTTP API

On ClickHouse 26.9+ with the `prometheus_api_v1` handler, `/labels` and `/label/:name/values` for a ClickHouse-backed PromQL source now proxy to the handler instead of querying the TimeSeries tags table with SQL. Older servers, servers without the handler, and sources set to `table-function` keep the SQL path, so a source that runs queries over HTTP on 26.6-26.8 still gets label autocomplete.
