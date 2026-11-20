---
'@hyperdx/app': patch
---

fix: keep search counts exact when a materialized view serves the histogram and trace RED charts. The view only holds whole buckets, so the partial first and last buckets of the selected range now come from the source table, and the results count again matches the rows in the results table.
