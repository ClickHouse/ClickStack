---
'@hyperdx/api': patch
---

feat: SLO definitions with a background status refresh, behind ENABLE_SLOS

Adds the SLO model and a /slos API for creating, listing, updating and
deleting SLOs. Saving runs the SLO's query over the last minute, so a
condition ClickHouse rejects fails the save with ClickHouse's message.
The check-alerts task refreshes each SLO's stored status for lists: burn
rates every 5 minutes from a 6-hour query in 5-minute buckets, and the SLI
and error budget every 30 minutes. A grouped SLO also stores the numbers
of its 100 busiest groups and how many groups there are. Queries use a
materialized view of the source when one covers them, and every query is
bounded by the refresh deadline so alert evaluation is never delayed.
