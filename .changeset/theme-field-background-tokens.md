---
'@hyperdx/app': patch
---

In dark mode, the field background now has opacity so it works on different
backgrounds, such as popovers. It is set directly in the theme tokens instead of
through a Click UI token that resolved to a solid color.
