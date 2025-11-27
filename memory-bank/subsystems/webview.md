---
id: webview
type: subsystem
status: planned
readiness: 0.1
parent: cline-memory-bank-extension
tags: [webview, ui, markdown, mermaid]
---
# Webview (Detail & Graph)

## Responsibilities
- Render summary (title, status, readiness, tags).
- Render markdown body.
- Optional graph (Mermaid/D3) of neighbors.

## Interfaces
- Message bridge: Extension → Webview (showNode), Webview → Extension (updateNode).

## Links
- Spec: README.md#3-detail--graph-view-via-webview
