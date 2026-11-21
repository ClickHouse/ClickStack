---
'@hyperdx/app': patch
---

feat: when a materialized view's configuration is inferred in the source form, its minimum date now defaults to the first whole bucket after the view was created. Views only hold rows inserted after they exist, so ranges before that read the source table instead of undercounting. Clear the date if the view was backfilled.
