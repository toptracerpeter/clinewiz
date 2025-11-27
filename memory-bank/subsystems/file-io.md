---
id: file-io
type: subsystem
status: planned
readiness: 0.1
parent: cline-memory-bank-extension
tags: [fs, parsing, gray-matter]
---
# File I/O

## Responsibilities
- Read/write markdown files in memory-bank/.
- Update frontmatter (status/readiness) safely.

## Interfaces
- gray-matter for parsing.
- VS Code workspace FS APIs.

## Links
- Spec: README.md#1-treat-the-memory-bank-as-structured-data
