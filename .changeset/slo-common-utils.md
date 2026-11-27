---
'@hyperdx/common-utils': patch
---

feat: SLO schema, burn rules and the counts query behind SLOs

Adds the SLO definition schema (availability or latency indicator, target,
rolling 7 or 30 day window, optional group-by expression, optional fast and
slow burn alerts), the single counts query every SLO number comes from,
overall or by group, and the math for the SLI, error budget and the fast
and slow burn rules (2% of the budget within an hour, 5% within six hours,
each with a short window that has to burn as fast). A grouped SLO tracks its 100
busiest groups, each with its own numbers; a group with fewer than 100
events in the window has no state of its own, and the SLO takes the state
of its worst group. Not used until SLOs are enabled.
