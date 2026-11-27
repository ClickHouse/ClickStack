---
'@hyperdx/app': patch
---

fix: give the collapsed side nav's links an accessible name. With the nav
collapsed to icons, the page links and the logo link had no text, so screen
readers announced them only as "link". The labels now stay in the page,
visually hidden.
