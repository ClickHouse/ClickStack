---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

feat: Ad hoc dashboard filter finishing touches

- Add an `IN` operator for SQL and a `=|` operator for PromQL. Conditions on the
  same key are OR'd into one `IN (...)` or `=~"a|b"` condition.
- Ad hoc filters always broadcast (`isBroadcastEnabled: true`), and their
  variable name is only a unique identifier. It is no longer declared as a
  `$variable`.
- Warn when another ad hoc filter already applies to the same sources.
- Collapse the filter input to three conditions behind a "+N more" toggle.
