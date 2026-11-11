---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

fix: "Denoise results" now removes noise on typical data. Noisy patterns are the most frequent ones until they cover half of the sampled events, instead of only patterns above 10% each, which often matched nothing. The same rule applies to the MCP `denoise` option. Denoise also mines the source's body column instead of the last table column, removes ANSI-colored rows that match a noisy pattern, and says when results can't be denoised.
