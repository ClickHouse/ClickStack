---
'@hyperdx/app': patch
---

fix: stop the previous filter type's validation from blocking a save after switching types

Switching a dashboard filter from "PromQL label values" to another type no longer fails with "Select a PromQL source".
