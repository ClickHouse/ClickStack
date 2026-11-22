---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: return the actual earliest/latest time for min/max on a date or time column

`min` and `max` on a Date, DateTime, or DateTime64 column (for example
`Timestamp`) returned 0, because every aggregation cast its value to Float64
first. Tables, number tiles, and the MCP `clickstack_table` tool now return the
timestamp itself. Line, bar, pie, and other charts, ratios, formulas, and number
tiles with several series keep the numeric cast.
