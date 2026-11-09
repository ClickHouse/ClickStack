---
'@hyperdx/api': patch
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

feat: Choose how a PromQL source on ClickHouse is evaluated (the Prometheus HTTP API or the `prometheusQuery` table functions) instead of probing the server on every query. Without a choice the server is still probed, but the answer is now kept for 5 minutes. A source set to the HTTP API against a server that does not serve it fails with a clear error. Onboarding pins a PromQL source it detects to the HTTP API when the server serves it.
