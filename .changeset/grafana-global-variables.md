---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
'@hyperdx/api': patch
---

feat: Grafana global variables in raw SQL and link templates

Raw SQL charts and row-click link templates now expand `${__from}` / `${__to}`
(epoch ms, or `:date`, `:date:iso`, `:date:seconds`), `$__range`, `$__range_s`,
`$__range_ms`, `${__timezone}`, `${__url_time_range}` and `${__all_variables}`.
Each also works in the bare `$__name` form, and any macro can now be written in
braces, e.g. `${__fromTime}`.
