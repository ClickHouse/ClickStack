---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: allow grouping gauge and sum metric charts by an expression over the time column

A table, pie or bar chart on a gauge or sum metric grouped by a time expression
such as `toStartOfHour(TimeUnix)` or `toDate(TimeUnix)` failed with
`Unknown identifier TimeUnix`, because the bucketed CTE the outer query reads
did not carry the time column. It now does when the group-by references it.
`increase` with a comma-separated group-by also filters empty values per column
instead of producing an invalid filter.
