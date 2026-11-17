---
'@hyperdx/api': patch
---

feat: `clickstack_save_alert` accepts `note` and `numConsecutiveWindows`

Updates that omit either field now keep the stored value instead of clearing it;
send `null` to clear.
