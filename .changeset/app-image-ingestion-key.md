---
'@hyperdx/api': patch
---

feat: add `ENABLE_INGESTION_API_KEY` to honor `INGESTION_API_KEY` on the app image

The app image ignores `INGESTION_API_KEY`, so an external collector has to use
the team's generated key, which changes whenever the team is recreated. Set
`ENABLE_INGESTION_API_KEY=true` on the API to accept a preset key alongside the
team key. Behavior is unchanged when unset.
