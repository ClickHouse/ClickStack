---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: compare numeric search bounds as numbers on String attributes

Searches like `LogAttributes.duration_ms:>1000` compared the attribute's text
value to `'1000'` as strings, so `'17.25' > '100'` matched and real matches
were missed, and ranges such as `:[10 TO 20]` failed with "no supertype for
types String, UInt8". A numeric bound on a String-typed field now compares
with `toFloat64OrNull`; values that aren't numbers don't match.
