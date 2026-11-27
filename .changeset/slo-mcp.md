---
'@hyperdx/api': patch
---

feat: SLO tools for MCP, registered when SLOs are enabled

Lists SLOs as a summary from their stored status, optionally by state, or
returns one SLO with its definition, its status computed when asked (per
group for a grouped SLO), its alerts' states and a SQL where clause that
selects its bad events for `clickstack_search`, for one group when asked.
`clickstack_preview_slo` dry runs a definition (good, bad and excluded
events, SLI, budget left, group count and the counts SQL),
`clickstack_save_slo` creates or updates 1 to 20 SLOs with an error per
failed item, and `clickstack_delete_slo` deletes an SLO with its alerts. They
use the same checks and team scoping as the SLO pages.
