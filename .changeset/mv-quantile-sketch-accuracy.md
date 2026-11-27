---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: read percentiles correctly from materialized views that store DDSketch (`quantileDD`) or GK (`quantileGK`) states. The merge now passes the sketch's accuracy ahead of the level, so charts and alerts no longer return a different percentile without an error, and GK views are no longer skipped.
