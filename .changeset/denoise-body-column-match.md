---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

fix: "Denoise results" now mines the source's body column instead of the last table column, removes ANSI-colored rows that match a noisy pattern, and matches rows to templates the same way as the MCP denoise. The panel now says when results can't be denoised, e.g. because the body column isn't in the table.
