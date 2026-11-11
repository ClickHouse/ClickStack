---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

fix: "Denoise results" now removes noise on typical data. A pattern now counts as noisy above 5% of sampled events instead of 10%, which often matched nothing. Patterns that include error or warning lines are never hidden. The MCP `denoise` option uses the same 5% threshold. Denoise also mines the source's body column instead of the last table column, removes ANSI-colored rows that match a noisy pattern, says when results can't be denoised, and shows hidden patterns as a short summary with a shortened, expandable list.
