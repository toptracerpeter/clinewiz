const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function parseFrontmatterAndBody(text) {
  const fmMatch = text.match(/^---\s*[\r\n]+([\s\S]*?)---\s*[\r\n]+([\s\S]*)$/);
  if (!fmMatch) return { frontmatter: {}, body: text };

  const fmText = fmMatch[1];
  const body = fmMatch[2];
  const frontmatter = {};

  fmText.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf(':');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim());
    } else if (!isNaN(Number(value))) {
      value = Number(value);
    }
    frontmatter[key] = value;
  });

  return { frontmatter, body };
}

function buildNodes(rootPath) {
  const memoryDir = path.join(rootPath, 'memory-bank');
  if (!fs.existsSync(memoryDir)) return [];

  const nodes = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const text = fs.readFileSync(full, 'utf8');
        const { frontmatter, body } = parseFrontmatterAndBody(text);
        const id = frontmatter.id || path.basename(entry.name, '.md');
        nodes.push({
          id,
          title: frontmatter.title || id,
          type: frontmatter.type || 'item',
          status: frontmatter.status || 'unknown',
          readiness: frontmatter.readiness || '',
          parent: frontmatter.parent || '',
          tags: frontmatter.tags || [],
          filePath: full,
          body
        });
      }
    }
  }
  walk(memoryDir);

  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  nodes.forEach(n => (n.children = []));
  nodes.forEach(n => {
    if (n.parent && byId[n.parent]) byId[n.parent].children.push(n.id);
  });
  return nodes;
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('memoryBank.openView', () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return vscode.window.showErrorMessage('Open a workspace first.');
      const root = folder.uri.fsPath;

      const panel = vscode.window.createWebviewPanel(
        'memoryBank',
        'Memory Bank',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      const html = fs.readFileSync(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview.html').fsPath,
        'utf8'
      );
      const jsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview.js')
      );
      panel.webview.html = html.replace('%WEBVIEW_JS%', jsUri.toString());

      let nodes = buildNodes(root);
      const update = () =>
        panel.webview.postMessage({ type: 'init', payload: { nodes } });
      update();

      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root, 'memory-bank/**/*.md')
      );
      watcher.onDidChange(() => { nodes = buildNodes(root); update(); });
      watcher.onDidCreate(() => { nodes = buildNodes(root); update(); });
      watcher.onDidDelete(() => { nodes = buildNodes(root); update(); });

      panel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'updateNode') {
          const { id, changes } = msg.payload;
          const node = nodes.find(n => n.id === id);
          if (!node) return;

          const orig = fs.readFileSync(node.filePath, 'utf8');
          const { frontmatter, body } = parseFrontmatterAndBody(orig);

          Object.assign(frontmatter, changes);
          const newText = `---\n` +
            Object.entries(frontmatter)
              .map(([k,v]) => `${k}: ${Array.isArray(v)?`[${v}]`:v}`)
              .join('\n') +
            `\n---\n\n${changes.body}`;
          fs.writeFileSync(node.filePath, newText, 'utf8');
          nodes = buildNodes(root);
          update();
        }

        if (msg.type === 'openFile') {
          const doc = await vscode.workspace.openTextDocument(msg.payload.filePath);
          vscode.window.showTextDocument(doc);
        }

        if (msg.type === 'askCline') {
          const node = nodes.find(n => n.id === msg.payload.id);
          if (!node) return;
          const prompt = `Update memory item ${node.id}.`;
          const doc = await vscode.workspace.openTextDocument({ content: prompt });
          const ed = await vscode.window.showTextDocument(doc);
          ed.selection = new vscode.Selection(0,0, doc.lineCount,0);
          vscode.commands.executeCommand('cline.addToChat');
        }
      });
    })
  );
}

module.exports = { activate };
