---
id: webview
type: subsystem
status: in-progress
readiness: 0.75
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

## Status Update (2025-12-02)
- Observability: Extension OutputChannel, webview console/error relay, visible error banner
- Graph robustness: width: 100%, ResizeObserver re-render, zero-size guard with hint
- Debug tools: Devbar (Output/Devtools/Reload), Debug panel (toggle, copy logs, reload)
- Link handling: Internal links route to nodes; external links open via openExternal
- Settings: path override, graphEnabled, markdownPreviewEnabled, refresh.debounceMs (package.json + wiring)
- Performance: Debounced file watcher updates
- Lazy-load bodies: body fetched on demand (fetchBody + body message)
- UX: Persisted UI state (selected node, filter, groupBy) across reloads
