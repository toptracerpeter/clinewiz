---
id: cline-integration
type: subsystem
status: planned
readiness: 0.1
parent: cline-memory-bank-extension
tags: [cline, prompts, automation]
---
# Cline Integration

## Responsibilities
- Generate task-specific prompts for a node.
- Open a temp document, select content, call `cline.addToChat`.

## Interfaces
- VS Code commands: `cline.addToChat`
- Command: `memoryBank.updateWithCline`

## Sketch
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

## Links
- Spec: README.md#4-making-ui-actions-generate-prompts-for-cline
