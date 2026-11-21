---
'@hyperdx/otel-collector': patch
---

fix(security): bump `clickhouse-go/v2` to v2.51.0 in the migration tool

Pulls in `github.com/andybalholm/brotli` v1.2.7, which fixes GO-2026-6888
(CVE-2026-111497), a denial of service in the brotli decompressor.
