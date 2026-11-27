---
'@hyperdx/app': patch
---

fix: close the time picker on a click outside it or on Escape. It stayed open,
including above the row side panel opened by clicking a search result.
