---
'@hyperdx/api': patch
---

fix: mark the MCP `clickstack_save_webhook` and `clickstack_save_alert` tools as open-world

Saved webhooks and alerts send HTTP requests to third-party endpoints, so both tools now declare `openWorldHint: true`.
