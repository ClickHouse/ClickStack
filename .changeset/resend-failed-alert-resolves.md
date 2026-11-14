---
'@hyperdx/api': patch
---

fix: a resolve notification whose webhook delivery fails is now sent again on
later checks, backing off up to every 30 minutes, for up to 24 hours. A resolve
that is never delivered is recorded on the alert's evaluation history. Webhook
delivery failures now log the underlying cause instead of only "fetch failed".
