---
'@hyperdx/app': minor
---

feat: filter for or exclude a pattern from Event Patterns

Each row in Event Patterns now has "Filter for this pattern" and "Exclude this
pattern" buttons on hover. Each adds a filter for every event that fits the
pattern in the time range, not only the sampled rows, so the results table,
histogram and counts all update. Exclusions stack, show as pills next to the
other filters, survive sidebar filter changes, and are kept in the URL and in
saved searches. A new include replaces the previous one, and switching source
removes pattern filters.
