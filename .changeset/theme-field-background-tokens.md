---
'@hyperdx/app': patch
---

Set the form field background directly in the light and dark theme tokens
instead of through a Click UI token. In dark mode the field is now a translucent
white overlay rather than a solid `#2d2d2d`, so it matches the surface beneath
it.
