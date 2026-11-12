---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

perf: read only 20 median-sized parts when discovering Map keys from a text index

Map key discovery read the text index dictionary of every part in the time
range, which is slow on tables with many parts. It now reads the 20 parts
closest to the median size. Log and trace sources can change the count with
the new "Map key index parts" setting (`mapKeyIndexMaxParts`).
