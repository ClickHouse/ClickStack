---
'@hyperdx/api': patch
---

fix: send a ClickStack User-Agent on generic alert webhooks

Generic and incident.io alert webhooks sent `User-Agent: undici`, which some
receivers' firewalls block with a 403. They now send
`ClickStack-Alerts/<version>`. A User-Agent set in the webhook's headers still
takes precedence.
