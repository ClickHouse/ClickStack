---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

feat: more global vars for dashboard links

- Row-click link templates can use `{{__from}}`, `{{__to}}`, `{{__timezone}}`,
  `{{__url_time_range}}`, `{{__all_variables}}`, and a
  `{{date <value> "iso"|"seconds"|"ms"}}` helper. External links now carry
  the time range this way.
- Dashboard links can set a destination filter by variable name
  (`kind: "variableTemplate"`), so static list filters can be prefilled.
- Dashboard links can carry the current dashboard's filters over
  (`includeCurrentFilters`).
- Markdown tiles expand `$__from`, `$__to`, `$__timezone`,
  `$__url_time_range` and `$__all_variables`, and a new `${var:url}` format
  URL-encodes variable values.
