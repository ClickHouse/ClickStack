---
'@hyperdx/api': patch
---

feat(mcp): `maxBodyChars` on `clickstack_event_patterns` and
`clickstack_emerging_signals` mines only the start of each body, so long stack
traces and dumps are cut in the query and their patterns can be drilled into
