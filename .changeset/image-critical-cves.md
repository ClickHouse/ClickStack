---
'@hyperdx/api': patch
'@hyperdx/app': patch
'@hyperdx/otel-collector': patch
---

fix: clear the critical CVEs from the app, collector and all-in-one images by
moving the collector to Alpine 3.24, upgrading gomplate to v5 and dropping the
unused goose and esbuild binaries. Custom entrypoints that called `goose`
directly should call `migrate` with the same schema directory instead.
