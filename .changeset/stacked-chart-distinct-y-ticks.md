---
'@hyperdx/app': patch
---

fix: stacked bar and stacked line charts no longer show duplicate Y-axis labels
(e.g. "0, 500, 1k, 2k, 2k" when 1.5k rounds to 2k)
