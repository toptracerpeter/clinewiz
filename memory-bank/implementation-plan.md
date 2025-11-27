---
id: implementation-plan
type: milestone
status: planned
readiness: 0.2
parent: cline-memory-bank-extension
tags: [plan, roadmap, mvp, vscode-extension]
---
# Implementation Plan

A step-by-step plan to implement the VS Code companion extension that treats `memory-bank/` as a structured knowledge base, renders it (TreeView + Webview), edits underlying markdown, and triggers Cline actions via generated prompts.

## Objectives
- Parse and present `memory-bank/` items as a navigable model (hierarchy + relations).
- Edit frontmatter fields safely (status, readiness, tags, parent).
- Generate structured prompts and hand them to Cline using existing VS Code commands.
- Provide a detail/graph view for richer navigation and context.

## Phases

### Phase 1 — Read-only Explorer (TreeView MVP)
Responsibilities:
- Scaffold extension structure (activate/deactivate, contribution points).
- Implement `MemoryTreeDataProvider` to:
  - Scan `memory-bank/` for `*.md` files.
  - Parse YAML frontmatter via `gray-matter`.
  - Map to a `MemoryNode` model, deriving parent/children from frontmatter.
  - Provide a basic hierarchy (group by `type` and/or by `parent`).
- Register a `TreeView` (`memoryBankView`) and two commands:
  - `memoryBank.openNode` → opens the raw markdown file.
  - `memoryBank.refresh` → reloads the tree.
- Add file watching (refresh tree on changes under `memory-bank/`).

Deliverables:
- Working TreeView with items reflecting the current memory bank.
- Clicking a node opens the corresponding `.md` file.

Acceptance Criteria:
- New files under `memory-bank/` appear after refresh.
- Frontmatter fields are parsed and logged without errors.
- No writes occur in this phase.

### Phase 2 — Status & Readiness Editing
Responsibilities:
- Frontmatter editing commands:
  - Quick input to set `status` (planned | in-progress | blocked | done).
  - Quick input to set `readiness` (0.0–1.0).
- Persist updates using `gray-matter` to safely patch the YAML block.
- Show basic visual indicators (icons/badges) for status/readiness in the TreeView.
- Handle validation (clamp readiness; allow only known statuses).

Deliverables:
- Commands available from command palette and context menu on tree items.
- TreeView reflects status/readiness post-update.

Acceptance Criteria:
- Edits persist to the correct file without corrupting other content.
- Basic error handling surfaced to the user (e.g., invalid YAML).

### Phase 3 — Cline Integration (Prompt Generation)
Responsibilities:
- Add `memoryBank.updateWithCline`:
  - Generate a structured prompt from the selected node (id, file path, current status/readiness, related paths).
  - Open an in-memory temp document with the prompt.
  - Select all text and call `vscode.commands.executeCommand('cline.addToChat')`.
- Optionally focus Cline chat input afterward (if command is available).
- Optionally append a line to `progress.md` (e.g., “Asked Cline to reconcile {id} …”) when convenient and safe.

Deliverables:
- “Ask Cline About This Item” command that sends a well-formed prompt to Cline.

Acceptance Criteria:
- Invoking the command results in a new Cline chat entry with the generated prompt.
- No Cline-specific API dependencies beyond existing VS Code commands.

### Phase 4 — Webview Detail & Graph
Responsibilities:
- Implement `MemoryWebview`:
  - Reusable panel to render currently selected node.
  - Message bridge Extension → Webview (`showNode`) and Webview → Extension (`updateNode`).
- In the Webview:
  - Render summary card (title, status, readiness, tags).
  - Render markdown (body) via `markdown-it` or `marked`.
  - Optional graph (Mermaid or simple D3 force graph) to show relationships:
    - parent/children, and basic cross-links from the `Links` section.
  - Clicking a neighbor posts back to the extension to run `memoryBank.openNode`.
- Implement `updateNode` handler in extension to patch frontmatter fields and/or content.

Deliverables:
- Single Webview panel with summary + rendered content, and optional graph.
- Clickable neighbors navigate between nodes.

Acceptance Criteria:
- Webview updates correctly when selecting different nodes.
- Updates made in Webview persist to disk and reflect in TreeView.

### Phase 5 — Polish, Packaging, and Docs
Responsibilities:
- Refine icons/badges, groupings, and labels.
- Contribute comprehensive README (usage, commands, screenshots/GIFs).
- Package and version (`vsce package` if desired).
- Add telemetry off by default (optional).
- Changelog for versions.

Deliverables:
- Polished UX, clear documentation, packaged extension.

Acceptance Criteria:
- All commands discoverable via Command Palette, inline context menus.
- README includes quickstart, features, and limitations.

## Data Model

### MemoryNode (internal)
- id: string (required)
- type: 'project' | 'subsystem' | 'feature' | 'concern' | 'milestone' | 'guideline'
- status: 'planned' | 'in-progress' | 'blocked' | 'done'
- readiness: number (0.0–1.0)
- parent?: string (id of parent)
- tags?: string[]
- filePath: string
- title: string (from markdown H1 or id)
- markdownBody: string (post-frontmatter)
- neighbors?: Array<{ id: string; relation: 'parent' | 'child' | 'link' }>

Validation:
- Default unknown/missing fields (e.g., readiness defaults to 0).
- Clamp readiness to [0, 1].
- Gracefully handle files missing frontmatter (treated as minimal nodes).

## Commands
- memoryBank.openNode (node) → open file
- memoryBank.refresh () → rebuild tree
- memoryBank.updateWithCline (node) → generate prompt and call `cline.addToChat`
- memoryBank.setStatus (node) → quick pick statuses
- memoryBank.setReadiness (node) → quick input slider (or text) 0–1

## Libraries and APIs
- gray-matter (frontmatter parse/serialize)
- markdown-it or marked (render markdown body in Webview)
- mermaid or d3 (optional graph)
- VS Code Extension API:
  - TreeDataProvider, TreeItem, WebviewPanel, workspace FS, commands, window

## File I/O and Watching
- Read: workspace.fs or Node fs (via `vscode.workspace` recommended).
- Write: reconstruct with `gray-matter` to avoid YAML corruption.
- Watch: `vscode.workspace.createFileSystemWatcher('**/memory-bank/**/*.md')`.

## Risks & Mitigations
- YAML corruption on write → Always round-trip with `gray-matter`; keep a backup.
- Large memory banks → Lazy load file content; cache parsed nodes; throttle refreshes.
- Webview security → Content Security Policy; sanitize markdown; avoid remote scripts.
- Cline command changes → Keep the integration decoupled; isolate prompt generation.

## Success Criteria
- Users can navigate, edit, and reconcile memory items with Cline without manual prompt writing.
- Memory bank remains the single source of truth for project structure and status.
- Minimal friction to onboard (no Cline forking, no custom chat plumbing).

## Rough Timeline (adjust as needed)
- Phase 1: 0.5–1 day
- Phase 2: 0.5–1 day
- Phase 3: 0.5 day
- Phase 4: 1–2 days
- Phase 5: 0.5 day

## Links
- Spec: README.md
- Memory bank: `memory-bank/`
