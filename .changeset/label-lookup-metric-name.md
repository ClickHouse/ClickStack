---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

perf: PromQL label lookups with `match[]` read only the matched metrics' tags
rows when every selector names its metric
