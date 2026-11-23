---
'@hyperdx/api': patch
---

fix: require `INGESTION_API_KEY` on the app image before any team exists

With `ENABLE_INGESTION_API_KEY` set and no team created yet, the collector's OTLP
receiver accepted data without authentication. It now requires the preset key.
