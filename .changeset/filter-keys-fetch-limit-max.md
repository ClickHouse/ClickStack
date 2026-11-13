---
'@hyperdx/app': patch
---

feat: allow up to 10,000 in the team "Filter Keys Fetch Limit" setting

The setting's input in Team settings stopped at 1,000 keys per column; it now
accepts up to 10,000. Map key discovery still returns at most 1,000 keys per
Map column.
