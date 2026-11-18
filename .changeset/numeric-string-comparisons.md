---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: support numeric range searches on String attributes

Range searches with numeric bounds on a String-typed field, such as
`LogAttributes.duration_ms:[10 TO 20]`, failed with "no supertype for types
String, UInt8". They now compare with `toFloat64OrNull`; values that aren't
numbers don't match. `>`, `<`, `>=` and `<=` still compare String fields as
text; use a range such as `:[1000 TO *]` for a numeric comparison.
