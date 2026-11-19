---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

perf: load search filter values faster in exact mode by reading several keys on
one Map column with a single `groupUniqArrayMap`, and by querying plain columns
and each Map or JSON column separately so slow attribute maps don't hold up the
rest
