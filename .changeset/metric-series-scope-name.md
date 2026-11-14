---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: keep metric series from different instrumentation scopes apart

Two instrumentation scopes can report the same metric with the same resource,
scope and point attributes. Metric charts and alerts keyed a series on those
attributes only, so they read the two scopes as one series: a gauge kept one
scope's value, a counter's `increase` and a histogram's count compared one
scope's total with the other's, and a group-by on `ScopeName` showed one scope.
The series key now includes `ScopeName`.
