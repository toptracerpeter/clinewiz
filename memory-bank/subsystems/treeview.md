---
id: treeview
type: subsystem
status: planned
readiness: 0.1
parent: cline-memory-bank-extension
tags: [vscode, ui, explorer]
---
# TreeView

## Responsibilities
- Scan memory-bank/ for markdown files.
- Parse frontmatter and present items in a hierarchy.
- Refresh on file change.

## Interfaces
- VS Code TreeDataProvider
- Commands: memoryBank.openNode, memoryBank.refresh

## Links
- Spec: README.md#2-vs-code-extension-structure-the-simplest-useful-ui
