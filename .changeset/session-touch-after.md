---
'@hyperdx/api': patch
---

perf: stop writing the login session to MongoDB on every API request. The
session's stored expiry now moves forward at most once an hour, and a startup
backfill applies this to sessions that already exist.
