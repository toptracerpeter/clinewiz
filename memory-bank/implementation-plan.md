---
id: implementation-plan
type: milestone
status: in-progress
readiness: 0.45
parent: cline-memory-bank-extension
tags: [plan, roadmap, mvp, vscode-extension, webview-only]
---
# Implementation Plan

A step-by-step plan to implement the VS Code companion extension that treats `memory-bank/` as a structured knowledge base, renders it (Webview-only Explorer + Detail/Graph), edits underlying markdown, and focuses on navigation and safe editing (no automatic Cline dispatch).

## Objectives
- Parse and present `memory-bank/` items as a navigable model (hierarchy + relations).
- Edit frontmatter fields safely (status, readiness, tags, parent) using reliable YAML round-tripping.
- No automatic prompt dispatch; users will write prompts manually in Cline. (Optional future: provide prompt-aid copy only).
- Provide a detail view and eventually a simple graph for richer navigation and context.
- Webview-only approach (no VS Code TreeView provider).

## Phases

### Phase 1 — Webview Explorer (List + Details)
Responsibilities:
- Scaffold extension structure (activate/deactivate, contribution points).
- Scan `memory-bank/` for `*.md` files.
- Parse YAML frontmatter via `gray-matter`.
- Map to a `MemoryNode` model, deriving parent/children from frontmatter.
- Render a searchable/filterable list in a Webview and show a basic details pane for the selected node.
- Add file watching (refresh list on changes under `memory-bank/`).
- Provide “Open File” to open the raw markdown file in the editor.

Deliverables:
- Working Webview-based explorer with items reflecting the current memory bank.
- Clicking an item selects it and shows basic details; “Open File” opens the `.md` file.

Acceptance Criteria:
- New files under `memory-bank/` appear after refresh.
- Frontmatter fields are parsed and logged without errors.

### Phase 2 — Webview Editing (Status/Readiness + Body)
Responsibilities:
- Edit frontmatter fields via the Webview (status, readiness; optionally title).
- Persist updates using `gray-matter` to safely patch the YAML block.
- Handle validation (clamp readiness to [0,1]; allow only known statuses).
- Preserve non-edited fields and content; do not corrupt YAML or body.

Deliverables:
- Edits initiated in Webview persist to disk.
- Basic error handling surfaced to the user (e.g., invalid YAML or invalid inputs).

Acceptance Criteria:
- Edits persist to the correct file without corrupting other content.
- Validation applied consistently; errors are surfaced with actionable messages.

### Phase 3 — Prompt Aid (Descoped)
This phase is intentionally descoped per project direction. Users will craft prompts directly in Cline. The UI focuses on navigation and editing; no automatic prompt dispatch.

### Phase 4 — Webview Graph & Markdown Rendering
Responsibilities:
- Render markdown body (read-only initially) via `markdown-it` or `marked`.
- Add a simple neighbor section or a minimal graph (Mermaid or small D3 force graph) to show relationships (parent/children and basic cross-links from a “Links” section).
- Clicking a neighbor posts back to the extension to open that node (or scroll/select in the list).

Deliverables:
- Single Webview panel with summary + rendered content, and a simple neighbor visualization.
- Clickable neighbors navigate between nodes.

Acceptance Criteria:
- Webview updates correctly when selecting different nodes.
- Navigation between neighbors is intuitive and reliable.

### Phase 5 — Polish, Packaging, and Docs
Responsibilities:
- Refine list UI (icons/badges for readiness/status), grouping, and labels.
- Contribute comprehensive README (usage, actions, screenshots/GIFs).
- Package and version (`vsce package` if desired).
- Add telemetry off by default (optional).
- Changelog for versions.

Deliverables:
- Polished UX, clear documentation, packaged extension.

Acceptance Criteria:
- Actions discoverable via the Webview and Command Palette where applicable.
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

## Actions and Commands
- memoryBank.openView → open the Webview-only explorer
- Webview message handlers:
  - updateNode → patch frontmatter/body with validation (Phase 2)
  - openFile → open file in editor

## Libraries and APIs
- gray-matter (frontmatter parse/serialize)
- markdown-it or marked (render markdown body in Webview)
- mermaid or d3 (optional graph)
- VS Code Extension API:
  - WebviewPanel, workspace FS, commands, window, FileSystemWatcher

## File I/O and Watching
- Read: Node fs or `vscode.workspace` FS.
- Write: reconstruct with `gray-matter` to avoid YAML corruption.
- Watch: `vscode.workspace.createFileSystemWatcher('**/memory-bank/**/*.md')`.

## Risks & Mitigations
- YAML corruption on write → Always round-trip with `gray-matter`; keep a backup if needed.
- Large memory banks → Lazy load file content; cache parsed nodes; throttle refreshes.
- Webview security → Content Security Policy + nonce; sanitize markdown; avoid remote scripts.
- Cline command changes → Keep the integration decoupled; isolate prompt generation.

## Success Criteria
- Users can navigate and edit; any Cline prompting is manual by the user (no automatic dispatch).
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
