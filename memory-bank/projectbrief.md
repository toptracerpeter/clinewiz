---
id: cline-memory-bank-extension
type: project
status: planned
readiness: 0.1
tags: [vscode-extension, memory-bank, cline, webview, treeview]
---
# Cline Memory Bank Companion Extension

A VS Code companion that:
- Treats memory-bank/ as structured data (markdown + YAML frontmatter).
- Renders items in a TreeView and detail/graph Webview.
- Lets users edit metadata/content.
- Generates prompts and invokes Cline (via cline.addToChat) to reconcile specs with code.

## Goals
- Simple, clickable model of the system from memory-bank/ content.
- Zero coupling to Cline internals; only use existing VS Code commands.
- Clear roadmap from MVP to graph visualization.

## Non-goals (initially)
- Full CRUD of complex schemas.
- Custom chat transport beyond cline.addToChat.
- Heavy runtime dependencies.

## Phases
1. Read-only explorer (TreeView)
2. Status/readiness editing
3. Cline prompt generation + dispatch
4. Webview detail + simple graph (Mermaid or D3)

## Links
- Spec: README.md (this repo)
- Memory Bank: memory-bank/
