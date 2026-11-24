---
'@hyperdx/app': patch
---

feat: SLO pages behind NEXT_PUBLIC_ENABLE_SLOS

Adds a list of SLOs, a builder with a preview of good, bad and excluded
events, and a detail page whose numbers and SLI, error budget and burn-rate
charts are computed when it opens, with its fast and slow burn alerts and
their firings over the last 7 days, and a flyout of bad events. A grouped SLO
expands into its groups in the list, and its detail page shows all groups
or one, picked from a menu or a link. The list filters by tag and source
and sorts by state, name, SLI, budget left or burn rate, and an SLO can be
duplicated without its alerts. Search gets an SLO button that starts the
builder from the current query, and SLO alerts show as such on the Alerts
page.
