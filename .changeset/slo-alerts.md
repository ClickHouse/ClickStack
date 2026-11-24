---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

feat: SLO fast and slow burn alerts as their own alert source

An SLO can have a fast burn and a slow burn alert, each an alert with the
new `slo` source and its own channels, kept in sync with the SLO. Fast burn
fires when 2% of the error budget is spent within an hour, slow burn when
5% is spent within six hours, and each needs its last 5 or 30 minutes to
burn as fast, so it resolves soon after a burn stops. Each notifies once
when it starts firing and once when it resolves, and its message names the
rule and states the numbers. A grouped SLO's alerts fire and resolve for
each group with enough events, and their notifications name the group and
link to it. Each check also stores the burn rates on the SLO, so the SLO
list shows the alerts' own verdict. SLO alerts are changed from their SLO,
stay out of the external alerts API, and only run while SLOs are enabled.
Deleting one from the Alerts page turns that alert off on its SLO.
