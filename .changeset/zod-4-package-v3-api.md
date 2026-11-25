---
'@hyperdx/api': patch
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

chore: move to the zod 4 package (^4.6.6) while keeping the zod 3 API through
`zod/v3` imports. Schemas and validation behavior are unchanged.
