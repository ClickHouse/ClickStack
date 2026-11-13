---
'@hyperdx/common-utils': minor
---

feat: add `buildCompactPatternPredicate`

It builds the same match as `buildPatternPredicate` in much shorter SQL, for
pattern filters that are kept in a URL. `parsePatternPredicate` reads both
forms.
