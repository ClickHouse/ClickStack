---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: allow grouping gauge and sum metric charts by an expression over the time column

A table, pie or bar chart on a gauge or sum metric grouped by a time expression
such as `toStartOfHour(TimeUnix)` or `toDate(TimeUnix)` failed with
`Unknown identifier TimeUnix`, because the bucketed CTE the outer query reads
did not carry the time column. When the group-by references it, `TimeUnix` now
resolves to each metric bucket's start, so values are the same as the chart
without the time group-by.
