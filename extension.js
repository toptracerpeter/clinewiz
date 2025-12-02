const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

function parseFrontmatterAndBody(text) {
  try {
    const parsed = matter(text);
    return { frontmatter: parsed.data || {}, body: parsed.content || '' };
  } catch (e) {
    console.error('Frontmatter parse error', e);
    return { frontmatter: {}, body: text };
  }
}

function loadMemory(rootPath) {
  // Support workspaces where the root *is* memory-bank/, or where memory-bank/ is inside the root
  const isRootMemoryDir = path.basename(rootPath) === 'memory-bank';
  const memoryDir = isRootMemoryDir ? rootPath : path.join(rootPath, 'memory-bank');
  const memoryDirExists = fs.existsSync(memoryDir);
  const watchPattern = isRootMemoryDir ? '**/*.md' : 'memory-bank/**/*.md';
  if (!memoryDirExists) return { nodes: [], memoryDirExists, rootPath, memoryDir, watchPattern };

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
  return { nodes, memoryDirExists, rootPath, memoryDir, watchPattern };
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

function activate(context) {
  const out = vscode.window.createOutputChannel('Memory Bank');
  context.subscriptions.push(out);
  let currentPanel = null;

  function revealPanel() {
    if (!currentPanel) return false;
    try { currentPanel.reveal(vscode.ViewColumn.Beside); } catch (_) {}
    return true;
  }

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
      currentPanel = panel;
      panel.onDidDispose(() => { currentPanel = null; });

      const html = fs.readFileSync(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview.html').fsPath,
        'utf8'
      );
      const jsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview.js')
      );
      const markedUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'media', 'marked.min.js')
      );
      const purifyUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'media', 'purify.min.js')
      );
      const nonce = getNonce();
      const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} https: data:; script-src 'nonce-${nonce}' ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline'; font-src ${panel.webview.cspSource}; connect-src ${panel.webview.cspSource};">`;
      panel.webview.html = html
        .replace('%WEBVIEW_JS%', jsUri.toString())
        .replace('%MARKED_URI%', markedUri.toString())
        .replace('%DOMPURIFY_URI%', purifyUri.toString())
        .replace('%NONCE%', nonce)
        .replace('%CSP%', csp);

      out.appendLine('Opened Memory Bank webview');

      let mem = loadMemory(root);
      let nodes = mem.nodes;
      const update = () => {
        out.appendLine(`Posting init with ${nodes.length} nodes (memoryDirExists=${mem.memoryDirExists}, root=${root})`);
        panel.webview.postMessage({
          type: 'init',
          payload: {
            nodes,
            rootPath: root,
            memoryDirExists: mem.memoryDirExists,
            memoryDir: mem.memoryDir,
            watchPattern: mem.watchPattern
          }
        });
      };
      update();

      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root, mem.watchPattern || 'memory-bank/**/*.md')
      );
      watcher.onDidChange(uri => { out.appendLine(`Changed: ${uri.fsPath}`); mem = loadMemory(root); nodes = mem.nodes; update(); });
      watcher.onDidCreate(uri => { out.appendLine(`Created: ${uri.fsPath}`); mem = loadMemory(root); nodes = mem.nodes; update(); });
      watcher.onDidDelete(uri => { out.appendLine(`Deleted: ${uri.fsPath}`); mem = loadMemory(root); nodes = mem.nodes; update(); });

      panel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'openDevtools') {
          if (revealPanel()) {
            vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
            out.appendLine('[webview] requested devtools');
          } else {
            vscode.window.showInformationMessage('Open the Memory Bank view first.');
          }
          return;
        }
        if (msg.type === 'reloadWebview') {
          if (revealPanel()) {
            vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
            out.appendLine('[webview] requested reload');
          } else {
            vscode.window.showInformationMessage('Open the Memory Bank view first.');
          }
          return;
        }
        if (msg.type === 'showOutput') {
          out.show(true);
          return;
        }
        if (msg.type === 'log') {
          const { level, message, stack } = msg.payload || {};
          const line = `[webview ${level || 'log'}] ${message || ''}${stack ? '\n' + stack : ''}`;
          out.appendLine(line);
          if (level === 'error') {
            vscode.window.setStatusBarMessage('Memory Bank: error in Webview (see Output)', 3000);
          }
          return;
        }
        if (msg.type === 'updateNode') {
          const { id, changes } = msg.payload;
          const node = nodes.find(n => n.id === id);
          if (!node) return;

          try {
            const orig = fs.readFileSync(node.filePath, 'utf8');
            const parsed = matter(orig);
            const data = { ...(parsed.data || {}) };

            if (typeof changes.title === 'string' && changes.title.trim().length) {
              data.title = changes.title.trim();
            }
            if (typeof changes.status === 'string') {
              const allowed = ['planned','in-progress','blocked','done'];
              if (!allowed.includes(changes.status)) {
                vscode.window.showErrorMessage(`Invalid status: ${changes.status}`);
                return;
              }
              data.status = changes.status;
            }
            if (typeof changes.readiness !== 'undefined') {
              const num = Math.max(0, Math.min(1, Number(changes.readiness)));
              if (Number.isNaN(num)) {
                vscode.window.showErrorMessage(`Invalid readiness: ${changes.readiness}`);
                return;
              }
              data.readiness = Number(num.toFixed(2));
            }

            const newBody = typeof changes.body === 'string' ? changes.body : (parsed.content || '');

            const serialized = matter.stringify(newBody, data);
            fs.writeFileSync(node.filePath, serialized, 'utf8');
            nodes = buildNodes(root);
            update();
            panel.webview.postMessage({ type: 'saved', payload: { id } });
          } catch (err) {
            console.error(err);
            out.appendLine('[updateNode error] ' + (err && err.stack ? err.stack : (err && err.message ? err.message : String(err))));
            vscode.window.showErrorMessage('Failed to update node: ' + (err.message || String(err)));
          }
        }

        if (msg.type === 'openFile') {
          const doc = await vscode.workspace.openTextDocument(msg.payload.filePath);
          vscode.window.showTextDocument(doc);
        }

      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('memoryBank.openDevtools', () => {
      if (revealPanel()) {
        vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
      } else {
        vscode.window.showInformationMessage('Open the Memory Bank view first.');
      }
    }),
    vscode.commands.registerCommand('memoryBank.reloadWebview', () => {
      if (revealPanel()) {
        vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
      } else {
        vscode.window.showInformationMessage('Open the Memory Bank view first.');
      }
    }),
    vscode.commands.registerCommand('memoryBank.showOutput', () => {
      out.show(true);
    })
  );
}

module.exports = { activate };
