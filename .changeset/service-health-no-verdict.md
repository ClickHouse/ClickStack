---
'@hyperdx/api': patch
---

fix(mcp): drop the health verdict from clickstack_service_health

The tool no longer labels services critical, degraded or healthy, and no longer
tells agents a service needs "no action". Each service keeps its threshold
flags, score and a factual summary, so agents reason from the numbers instead of
a verdict that service-wide totals can get wrong. `summary.statusCounts` is
replaced by `summary.servicesFlagged`, and the span attributes
`mcp.service_health.critical_count` and `mcp.service_health.degraded_count` are
replaced by `mcp.service_health.flagged_count`.
