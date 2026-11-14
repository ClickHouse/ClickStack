---
'@hyperdx/api': patch
---

perf: check-alerts gives each alert only its own previous history, so a tick
no longer scans every alert's group history once per alert
