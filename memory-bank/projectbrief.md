---
id: cline-memory-bank-extension
type: project
status: planned
readiness: 0.1
tags: [vscode-extension, memory-bank, cline, webview]
---
# Cline Memory Bank Companion Extension

A VS Code companion that:
- Treats memory-bank/ as structured data (markdown + YAML frontmatter).
- Renders items in a Webview (list + detail/graph).
- Lets users edit metadata/content.
- Provides prompt-aid context users can copy into Cline chat (no automatic dispatch).

## Goals
- Simple, clickable model of the system from memory-bank/ content.
- Zero coupling to Cline internals; only use existing VS Code commands.
- Clear roadmap from MVP to graph visualization.

## Non-goals (initially)
- Full CRUD of complex schemas.
- Custom chat transport beyond cline.addToChat.
- Heavy runtime dependencies.

## Phases
1. Webview explorer (list + details)
2. Status/readiness editing
3. Prompt aid (copy to Cline manually; no dispatch)
4. Webview detail + simple graph (Mermaid or D3)

## Links
- Spec: README.md (this repo)
- Memory Bank: memory-bank/
