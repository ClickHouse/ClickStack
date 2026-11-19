---
'@hyperdx/api': patch
---

perf(api): a due grouped alert that a value of 0 does not breach reads only its
last evaluation's history rows, one per group, instead of every row in the
lookback window
