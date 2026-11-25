---
'@hyperdx/api': minor
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

feat: add an "All" option to static list dashboard filters. Turn on "Include "All" option" in the filter's settings, and its dropdown offers "All", which selects every option. With "All" selected, `$variable` and `$__filter` use every option and `$__conditionalAll` expands to `1=1`, matching Grafana. The external API and MCP accept `allowAll` on static list filters and `all: true` on saved filter values.
