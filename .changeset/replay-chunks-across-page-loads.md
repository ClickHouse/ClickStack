---
'@hyperdx/app': patch
---

fix: keep session replay events from different page loads apart

Browser SDKs up to `@clickhouse/clickstack-browser` 1.2.0 number replay events
from 1 again on every page load. When a page closed before all chunks of a large
event were sent, its leftover chunk could be joined with a later page's event of
the same number. That page's snapshot then failed to parse and did not render.
Chunks are now grouped by event number and full-precision timestamp, and replay
rows are ordered by the full-precision timestamp, so rows of two page loads in
the same second no longer interleave.

The app's own browser telemetry now uses `@clickhouse/clickstack-browser` 1.2.1,
whose replay event numbers no longer repeat across page loads.
