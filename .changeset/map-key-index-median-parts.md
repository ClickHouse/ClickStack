---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

perf: read only 20 median-sized parts for text index key and value lookups

Map key discovery and "all values" lookups on text indexes read the index
dictionary of every part in the time range, which is slow on tables with many
parts. They now read the 20 parts closest to the median size. Log and trace
sources can change the count with the new "Map key index parts" setting
(`mapKeyIndexMaxParts`), and which parts are read with "Map key index part size"
(`mapKeyIndexPartSelection`: median, smallest, or largest). "Load more" on a
single filter key still reads every part in the time range.
