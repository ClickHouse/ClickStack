---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

feat: create SQL query dashboard filters and fill their dropdowns

Dashboard filters can now take their values from a ClickHouse SQL query. The filter editor offers a "SQL query values" type with a connection, a SQL editor, and a preview of the values. The dropdown lists the query's first column in the order it returns, up to 10,000 values, and the query can use the time macros and other filters' variables.
