---
'@hyperdx/api': patch
---

fix(mcp): Rename `clickstack_trace_top_time_consuming_operations` to `clickstack_trace_top_time_consuming_ops`

The old name was the longest MCP tool name and exceeded the tool-name length
limit some MCP clients enforce. Clients that call the tool by its old name
need to switch to the new one.
