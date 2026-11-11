---
'@hyperdx/cli': minor
'@hyperdx/app': patch
---

feat: add `hdx mcp install` to connect AI agents without pasting a key

`npx @hyperdx/cli mcp install` asks for a personal access key or an
organization API key with hidden input, checks it, and adds the ClickStack MCP
server to Claude Code, Codex, Cursor, and VS Code. Team Settings now leads with
this command, so the key no longer has to go into a copied command or an agent
chat. The per-agent snippets remain for setting up one agent by hand.
