---
'@hyperdx/api': patch
---

fix(mcp): `clickstack_describe_source` on a PromQL source over a ClickHouse TimeSeries table reads metric names from the tags table without a time window, so it no longer runs out of memory on large tables. Label names are listed per metric with the new `metricName` argument.
