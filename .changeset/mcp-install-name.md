---
'@hyperdx/cli': patch
---

feat(cli): `hdx mcp install` can keep several ClickStack servers side by side

`--name <server-name>` adds the MCP server under a name you choose, so a second
ClickStack instance no longer overwrites the first. When the key belongs to
more than one team, the installer asks which team the server should query, and
when it finds more than one agent it asks which to set up.
