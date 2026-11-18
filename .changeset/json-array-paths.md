---
'@hyperdx/app': patch
---

fix: address JSON array elements by index in row-panel filters

"Add to Filters" on a value inside an array in a native JSON column now uses
1-based array subscripts, for example `events[1]`, instead of quoted keys such
as `events.0`, so the filter matches rows instead of silently returning none.

The same applies to arrays inside a JSON string (for example a String `Body`
column), which now pass 1-based integer indexes to `JSONExtract*`. JSON strings
stored in a native JSON column are wrapped in `toString()` so `JSONExtract*`
accepts them.
