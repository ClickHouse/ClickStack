---
'@hyperdx/app': patch
---

Fix blank search panel when switching from a trace source in Event Deltas mode
to a source that doesn't support deltas (e.g. a log source). The view now falls
back to the results table and shows a notification.
