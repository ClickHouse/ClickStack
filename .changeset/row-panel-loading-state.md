---
'@hyperdx/app': patch
---

fix: show a loader while row details load

Expanded search rows and the trace viewer's span details showed "Empty" or "No
body for this event." while the row was still loading. They now show a loader
until the row arrives.
