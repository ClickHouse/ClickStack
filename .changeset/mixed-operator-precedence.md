---
'@hyperdx/common-utils': patch
---

fix: preserve boolean grouping when a search mixes AND and OR without explicit
parentheses, so generated SQL no longer regroups the query as `(a AND b) OR c`
