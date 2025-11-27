# Cline Memory Bank Companion Extension — Minimal Architecture & MVP

A tiny VS Code companion that:
- Treats `memory-bank/` as a structured knowledge base (Markdown + YAML frontmatter)
- Renders items in a TreeView and a Webview (lists, details, simple graphs)
- Edits the underlying Markdown files (frontmatter and body)
- Generates prompts and uses Cline commands so it behaves as if you’d written the prompt yourself

Note: You don’t need to fork Cline; this extension “sits next to it” and invokes existing VS Code commands exposed by Cline.

## 1) Treat the Memory Bank as Structured Data

Cline expects a `memory-bank/` directory with files like `projectbrief.md`, `systemPatterns.md`, `progress.md`, etc. To make these “clickable”, add light structure in YAML frontmatter:

```md
---
id: scoring-engine
type: subsystem     # subsystem | feature | concern | etc.
status: in-progress
readiness: 0.6      # 0–1 float
parent: backend
tags: [ranking, scoring]
---
# Scoring engine

High-level description...

## Responsibilities
- ...

## Interfaces
- ...

## Links
- Code: services/scoring/
- Spec: docs/scoring-spec.md
```

Parse with `gray-matter` to build:
- A node graph (relations via parent, cross-links in “Links”)
- Status/readiness views (simple list with badges/filters)

## 2) VS Code Extension Structure (Simplest Useful UI)

At minimum:
- TreeView — shows memory-bank items in a hierarchy/list
- WebviewPanel — rich detail view and optional graph (e.g., Mermaid/D3)
- File I/O — read/write Markdown files, update frontmatter

### High-level extension skeleton (TypeScript)

```ts
// src/extension.ts
import * as vscode from 'vscode';
import { MemoryTreeDataProvider } from './memoryTree';
import { MemoryWebview } from './memoryWebview';

export function activate(context: vscode.ExtensionContext) {
  const treeDataProvider = new MemoryTreeDataProvider();
  vscode.window.createTreeView('memoryBankView', { treeDataProvider });

  const webview = new MemoryWebview(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand('memoryBank.openNode', (node) => {
      webview.show(node); // show detail/graph view for this item
    }),
    vscode.commands.registerCommand('memoryBank.refresh', () => {
      treeDataProvider.refresh();
    }),
    vscode.commands.registerCommand('memoryBank.updateWithCline', (node) => {
      updateNodeWithCline(node); // see section 4
    }),
  );
}

export function deactivate() {}
```

### Contribution points in `package.json`

```json
{
  "contributes": {
    "views": {
      "explorer": [
        {
          "id": "memoryBankView",
          "name": "Memory Bank"
        }
      ]
    },
    "commands": [
      {
        "command": "memoryBank.openNode",
        "title": "Open Memory Item"
      },
      {
        "command": "memoryBank.updateWithCline",
        "title": "Ask Cline About This Item"
      }
    ]
  }
}
```

The `MemoryTreeDataProvider` scans `memory-bank/`, parses frontmatter, and turns files/sections into `TreeItem`s (icons can reflect `type` or `status`).

## 3) Detail & Graph View via Webview

Use a single Webview panel that you reuse and pass a JSON representation of the selected node + neighbors.

Extension → Webview:

```ts
// MemoryWebview.ts
panel.webview.postMessage({
  type: 'showNode',
  payload: {
    id: node.id,
    title: node.title,
    status: node.status,
    readiness: node.readiness,
    markdown: node.markdown,
    neighbors: node.neighbors
  }
});
```

Webview → Extension (for edits/actions):

```js
// In webview JS
// When user edits description or clicks "Set status: done"
vscode.postMessage({
  type: 'updateNode',
  payload: { id, status: 'done', readiness: 1.0 }
});
```

Back in the extension, receive the message and update the underlying Markdown file (patch status/readiness in the YAML frontmatter using `gray-matter`, or rewrite the file with serialized frontmatter + body).

## 4) Generating Prompts for Cline

Cline exposes VS Code commands such as `cline.addToChat`. You don’t get a direct “sendPrompt(text)” API, but you can:
- Generate your prompt as text
- Open a temp document, select all, then call `vscode.commands.executeCommand('cline.addToChat')`
- Cline grabs the selection and treats it as user input

```ts
async function updateNodeWithCline(node: MemoryNode) {
  const prompt = `
Update the Memory Bank entry "${node.id}":

- File: ${node.filePath}
- Current status: ${node.status}, readiness: ${node.readiness}

Tasks:
1. Inspect related code at: ${node.relatedPaths.join(', ')}
2. Update the spec text if needed.
3. Adjust readiness and status in the frontmatter.
4. Reflect any TODOs in progress.md.
  `.trim();

  const doc = await vscode.workspace.openTextDocument({
    content: prompt,
    language: 'markdown'
  });
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(prompt.length)
  );
  editor.selection = new vscode.Selection(fullRange.start, fullRange.end);

  await vscode.commands.executeCommand('cline.addToChat');
}
```

From the user’s perspective:
- Click a memory item in the tree
- Click “Ask Cline to reconcile spec & code”
- Cline’s chat opens with a structured prompt as if they typed it

## 5) Keeping It Simple (MVP)

- Phase 1 — Read-only Explorer
  - Implement `MemoryTreeDataProvider`: read files, parse frontmatter, render tree, open files on click

- Phase 2 — Status & Readiness
  - Icons/labels based on status/readiness
  - Quick-pick command to set fields and persist via `gray-matter`

- Phase 3 — Cline Integration
  - “Update with Cline” command that does the `cline.addToChat` trick

- Phase 4 — Visual Graph
  - Webview detail panel with:
    - Node summary (title, readiness, status, tags)
    - Rendered Markdown body
    - Simple Mermaid/D3 graph of neighbors (parent/children, links)
  - Click nodes in the graph → message back to extension → `memoryBank.openNode`

## Links

- Cline Docs: https://docs.cline.bot
- Memory Bank directory: `memory-bank/`

## Installation and Usage

Option A — Run in an Extension Development Host (fastest during development)
- Open this folder in VS Code.
- Press F5 or Run and Debug → “Run Extension”.
- A new Extension Development Host window opens.
- In that window, open a workspace that includes the memory-bank/ directory.
- Stop by closing the Dev Host or stopping the debugger.

Option B — Package and install as a VSIX (same VS Code instance)
- Ensure Node.js and the VS Code CLI (code) are available in your PATH.
- Package the extension from the repo root:
```bash
npx --yes @vscode/vsce package
```
- Install the generated .vsix into the current VS Code:
```bash
code --install-extension memory-bank-view-0.0.1.vsix
```
- Reload the window if prompted.
- Run the command from the Command Palette:
```text
Open Memory Bank View
```

Use this extension in another VS Code project
- Copy or share the .vsix file (e.g., memory-bank-view-0.0.1.vsix).
- Install it in the other VS Code instance:
```bash
code --install-extension /path/to/memory-bank-view-0.0.1.vsix
```
- Open a workspace that contains a memory-bank/ folder (or add one).
- Run the command “Open Memory Bank View” from the Command Palette.
- Updating: repackage and reinstall with --force:
```bash
npx --yes @vscode/vsce package
code --install-extension memory-bank-view-0.0.1.vsix --force
```
- Uninstall (if needed):
```bash
code --uninstall-extension local.memory-bank-view
```

## Summary

This companion extension lets you:
- Navigate the system at spec-level via `memory-bank/`
- Click a part, see graph + readiness + description
- Invoke Cline with rich, generated prompts derived from current state
- Keep `memory-bank/` as the single source of truth while Cline updates files as usual
