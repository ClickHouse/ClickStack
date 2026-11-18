---
'@hyperdx/app': patch
---

Bring back the Claude Code and Codex CLI commands in the MCP setup panel, next
to the `hdx mcp install` command, so connecting an agent no longer needs another
CLI installed. The commands ask for the access key at a hidden prompt, so it
stays out of shell history and agent chats.
