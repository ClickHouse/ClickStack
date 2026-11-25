---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

fix: PromQL label lookups with `match[]` work on ClickHouse 26.11, which
requires the `return_columns` argument of `timeSeriesSelector()`
