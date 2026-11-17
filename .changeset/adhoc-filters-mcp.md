---
'@hyperdx/api': minor
---

feat(mcp): Create, read, and update ad hoc dashboard filters through the MCP dashboard tools

`clickstack_save_dashboard`, `clickstack_get_dashboard`, and
`clickstack_patch_dashboard` now handle `ADHOC` filters and their `adhoc`
saved conditions. PromQL ad hoc filters are offered only while PromQL is
enabled, and are hidden and kept on update otherwise. Saved conditions that
name no ad hoc filter, or use an operator their filter can't apply, produce a
warning.
