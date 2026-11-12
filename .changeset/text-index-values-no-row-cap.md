---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: show values for every key in text index value lookups

"All values" lookups that read a text index (Map key=value indexes and text
indexes on plain columns) stopped at `max_rows_to_read` with
`read_overflow_mode = 'break'`. The index is read in sorted token order, so once
a high-cardinality key used up the budget, every key that sorts after it came
back with no values and no error. These lookups no longer apply a row cap.

To keep them bounded, they now read a limited set of parts like Map key
discovery: the 20 parts closest to the median size by default, or as set by the
source's "Map key index parts" (`mapKeyIndexMaxParts`) and "Map key index part
size" (`mapKeyIndexPartSelection`) settings, which now cover values as well as
keys.
