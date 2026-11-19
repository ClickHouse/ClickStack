---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix: return partial rows from `clickstack_search` instead of timing out

The MCP search tool now scans newest-first over the same progressive time
windows as the app's search page, under a 25s budget. When time runs out it
returns the rows found so far with a `partial` block (requested range, the range
fully covered, and the window that was cut off) and a hint for the next call,
instead of failing after 30s. The time-window helpers moved from the app to
`@hyperdx/common-utils/core/searchWindows`; the app's behavior is unchanged.
