---
'@hyperdx/app': patch
---

fix: give the collapsed side nav's Help button an accessible name. With the nav
collapsed to icons, screen readers announced it only as "button" (or as "New
updates available" when a release was unseen). The Help label now stays in
the page, visually hidden.
