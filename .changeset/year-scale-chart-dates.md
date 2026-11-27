---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix: label time charts spanning a year or more by month and year. X-axis ticks
sit on month starts and read like `Mar 2024`, and tooltips show the year
(`2024-03-18`, without a time of day for daily or coarser buckets). Shorter
ranges keep their existing formats.
