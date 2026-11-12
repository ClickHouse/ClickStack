---
'@hyperdx/app': patch
---

fix: address JSON array elements by index in row-panel filters

"Add to Filters" on a value inside an array in a native JSON column now uses
1-based array subscripts, for example `events[1]`, instead of quoted keys such
as `events.0`, so the filter matches rows instead of silently returning none.
