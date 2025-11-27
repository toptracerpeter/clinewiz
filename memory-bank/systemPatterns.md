---
id: system-patterns
type: guidelines
status: planned
readiness: 0.2
parent: cline-memory-bank-extension
tags: [conventions, schema]
---
# System Patterns and Conventions

## Frontmatter Schema
- id: unique slug for the item (e.g., treeview)
- type: project | subsystem | feature | concern | milestone | guideline
- status: planned | in-progress | blocked | done
- readiness: 0.0–1.0
- parent: id of parent node
- tags: list of labels

## File Naming
- One item per file.
- Slugs match IDs where possible.

## Content Sections
- # Title
- ## Responsibilities
- ## Interfaces
- ## Links

## Graph Relations
- parent indicates hierarchy.
- Cross-links can be added in Links using relative paths or repo paths.
