---
'@hyperdx/api': patch
---

perf: bound the check-alerts previous-history lookup by the alert interval

The check-alerts task no longer scans 7 days of alert history per alert on
every tick. A one-row lookup per alert skips alerts already evaluated in the
current window. Non-grouped alerts take their previous state from that row,
and grouped alerts scan a window sized to their interval (1 to 7 days).
