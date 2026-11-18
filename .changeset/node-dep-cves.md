---
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: update the Node dependencies flagged as vulnerable in the app image (axios,
MCP SDK, express, js-yaml, brace-expansion and others). MCP tool validation
errors still name the field that failed under the new MCP SDK, and list the
accepted values when a tile's `displayType` is wrong.
