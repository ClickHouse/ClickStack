---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/cli': patch
---

fix: MCP and CLI event patterns split bodies on punctuation, as the web app does

The MCP tools (`event_patterns`, `emerging_signals`, search denoise) and the CLI
split bodies on ASCII punctuation as well as whitespace, the same as the web
app's drain3 miner. JSON and other compact bodies now mine into readable
templates instead of one cluster per line. Date masks stay: a mask is a token of
its own, and drill-down predicates match the raw date it replaced. The Drain
port also no longer makes empty tokens for lines that start or end with a
delimiter, matching drain3.
