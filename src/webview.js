(function(){
  const vscode = acquireVsCodeApi();
  let nodes = [];
  let byId = {};
  let selected = null;
  let rootPath = '';
  let memoryDirExists = true;
  let memoryDir = '';

  const tree = document.getElementById('tree');
  const details = document.getElementById('details');
  const graph = document.getElementById('graph');
  const filter = document.getElementById('filter');
  const groupBySel = document.getElementById('groupBy');
  const rightbar = document.getElementById('rightbar');
  const progressWidget = document.getElementById('progressWidget');
  const banner = document.getElementById('banner');
  const devbar = document.getElementById('devbar');

  function postLog(level, message, error) {
    try {
      vscode.postMessage({
        type: 'log',
        payload: {
          level,
          message: String(message || ''),
          stack: error && error.stack ? error.stack : undefined
        }
      });
    } catch (_) {}
  }

  function showBanner(msg, kind) {
    if (!banner) return;
    banner.className = kind === 'info' ? 'info' : '';
    banner.textContent = String(msg || '');
    banner.style.display = 'block';
  }
  function hideBanner() {
    if (!banner) return;
    banner.style.display = 'none';
  }

  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console)
  };
  ['log','warn','error','info'].forEach(level => {
    console[level] = (...args) => {
      try { originalConsole[level](...args); } catch (_) {}
      try {
        postLog(level, args.map(a => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); }
          catch { return String(a); }
        }).join(' '));
      } catch (_) {}
    };
  });

  window.onerror = function(message, source, lineno, colno, error) {
    showBanner(`Error: ${message} (${source}:${lineno}:${colno})`);
    postLog('error', `${message} at ${source}:${lineno}:${colno}`, error);
    return false;
  };
  window.addEventListener('unhandledrejection', function(ev) {
    const reason = ev && ev.reason ? (ev.reason.message || String(ev.reason)) : 'unhandledrejection';
    showBanner(`Unhandled promise rejection: ${reason}`);
    postLog('error', `Unhandled rejection: ${reason}`, ev && ev.reason);
  });

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  function findProgressNode() {
    return nodes.find(n => (n.type === 'progress') || n.id === 'progress-log');
  }

  function sectionLinesFrom(body, title) {
    if (!body) return [];
    const re = new RegExp(`(^|\\n)##\\s+${title}[\\s\\S]*?(?=\\n##\\s+|$)`, 'i');
    const m = body.match(re);
    if (!m) return [];
    // Remove the heading line, then take bullet lines
    const lines = m[0].split('\n').slice(1);
    return lines
      .map(l => l.trim())
      .filter(l => l.startsWith('- '))
      .map(l => l.replace(/^-\\s*/, '').trim());
  }

  function renderProgressWidget() {
    if (!progressWidget) return;
    const p = findProgressNode();
    let html = '';
    if (p) {
      const backlog = sectionLinesFrom(p.body, 'Backlog');
      const inprog = sectionLinesFrom(p.body, 'In Progress');
      const done = sectionLinesFrom(p.body, 'Done');
      const log = sectionLinesFrom(p.body, 'Log');

      const mkList = (arr, act) => {
        if (!arr || arr.length === 0) return '<div style="color:#777;">(empty)</div>';
        return arr.slice(0, 6).map((t, i) => `
          <div class="pw-item" data-act="${act}" data-text="${escapeHtml(t)}">
            ${escapeHtml(t)}
          </div>
        `).join('');
      };

      // Summary by status
      const byStatus = nodes.reduce((acc, n) => {
        const k = (n.status || 'unknown').toLowerCase();
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      const statusRow = Object.keys(byStatus).sort().map(k => `
        <span class="badge">${escapeHtml(k)}: ${byStatus[k]}</span>
      `).join(' ');

      html = `
        <div class="pw-section">
          <h4>Summary</h4>
          <div>Total items: ${nodes.length}</div>
          <div style="margin-top:4px;">${statusRow}</div>
        </div>
        <div class="pw-section">
          <h4>Backlog</h4>
          ${mkList(backlog, 'filter')}
        </div>
        <div class="pw-section">
          <h4>In Progress</h4>
          ${mkList(inprog, 'filter')}
        </div>
        <div class="pw-section">
          <h4>Done (recent)</h4>
          ${mkList(done, 'explain')}
        </div>
        <div class="pw-section">
          <h4>Log (recent)</h4>
          ${mkList(log, 'explain')}
        </div>
        <div id="progressExplain" style="margin-top:8px;"></div>
      `;
    } else {
      html = '<div style="color:#777;">No progress log found.</div>';
    }
    progressWidget.innerHTML = html;
  }

  function statusIcon(s) {
    switch ((s || '').toLowerCase()) {
      case 'done': return '🟢';
      case 'in-progress': return '🟡';
      case 'blocked': return '🔴';
      case 'planned': return '⚪';
      default: return '⚫';
    }
  }
  function fmtReadiness(r) {
    const num = Number(r);
    if (Number.isFinite(num)) return `${Math.round(num * 100)}%`;
    return '';
  }

  function renderTree() {
    const f = filter.value.toLowerCase();
    const mode = (groupBySel && groupBySel.value) ? groupBySel.value : 'none';
    tree.innerHTML = '';

    if (!nodes.length) {
      const div = document.createElement('div');
      div.style.color = '#888';
      const base = memoryDir || (rootPath ? (rootPath + '/memory-bank') : 'memory-bank');
      const reason = memoryDirExists ? 'No markdown files found.' : `Folder not found: ${base}`;
      div.textContent = `No nodes loaded. ${reason}`;
      tree.appendChild(div);
      return;
    }

    // Filtered set
    const filtered = nodes.filter(n => {
      const hay = `${n.title} ${n.id}`.toLowerCase();
      return !f || hay.includes(f);
    });

    if (mode === 'none') {
      filtered.forEach(n => {
        const div = document.createElement('div');
        div.textContent = `${n.title} ${statusIcon(n.status)} ${fmtReadiness(n.readiness)}`;
        div.style.cursor = 'pointer';
        if (n.id === selected) div.style.fontWeight = 'bold';
        div.onclick = () => select(n.id);
        tree.appendChild(div);
      });
      return;
    }

    // Group by 'type' or 'status'
    const groups = new Map();
    filtered.forEach(n => {
      const key = (n[mode] || 'unknown').toString();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });

    Array.from(groups.keys()).sort().forEach(key => {
      const header = document.createElement('div');
      header.innerHTML = `<b>${mode}: ${key}</b>`;
      header.style.marginTop = '6px';
      tree.appendChild(header);

      groups.get(key).forEach(n => {
        const div = document.createElement('div');
        div.textContent = `${n.title} ${statusIcon(n.status)} ${fmtReadiness(n.readiness)}`;
        div.style.cursor = 'pointer';
        div.style.marginLeft = '8px';
        if (n.id === selected) div.style.fontWeight = 'bold';
        div.onclick = () => select(n.id);
        tree.appendChild(div);
      });
    });
  }

  function select(id) {
    selected = id;
    try { renderTree(); } catch (e) { showBanner('renderTree failed'); postLog('error', 'renderTree failed', e); }
    try { renderDetails(); } catch (e) { showBanner('renderDetails failed'); postLog('error', 'renderDetails failed', e); }
    try { renderGraph(); } catch (e) { showBanner('renderGraph failed'); postLog('error', 'renderGraph failed', e); }
  }

  function renderDetails() {
    const n = byId[selected];
    if (!n) { details.innerHTML = 'Select item'; return; }

    details.innerHTML = `
      <div id="err" style="color:#d33;"></div>
      <div id="ok" style="color:#090;"></div>
      <div><b>ID:</b> ${n.id}</div>
      <div><b>Title:</b> <input id="t" value="${n.title}"></div>
      <div><b>Status:</b>
        <select id="s">
          <option value="planned"${n.status==='planned'?' selected':''}>planned</option>
          <option value="in-progress"${n.status==='in-progress'?' selected':''}>in-progress</option>
          <option value="blocked"${n.status==='blocked'?' selected':''}>blocked</option>
          <option value="done"${n.status==='done'?' selected':''}>done</option>
        </select>
      </div>
      <div><b>Readiness (0-1):</b> <input id="r" type="number" min="0" max="1" step="0.01" value="${n.readiness}"></div>
      <div><b>Content:</b><div id="preview" style="border:1px solid #ccc;padding:8px;margin-top:6px;"></div></div>
      <button id="save">Save</button>
      <button id="open">Open File</button>
    `;

    const err = document.getElementById('err');
    const target = document.getElementById('preview');
    try {
      if (window.marked && typeof marked.parse === 'function') {
        let html = marked.parse(n.body || '');
        if (window.DOMPurify && typeof DOMPurify.sanitize === 'function') {
          html = DOMPurify.sanitize(html);
        }
        target.innerHTML = html;
      } else {
        target.textContent = n.body || '';
      }
    } catch (e) {
      target.textContent = n.body || '';
    }

    document.getElementById('save').onclick = () => {
      err.textContent = '';
      const title = document.getElementById('t').value;
      const status = document.getElementById('s').value;
      const readinessInput = document.getElementById('r');
      let readiness = Number(readinessInput.value);

      const allowed = ['planned','in-progress','blocked','done'];
      if (status && !allowed.includes(status)) {
        err.textContent = `Invalid status: ${status}`;
        return;
      }
      if (Number.isNaN(readiness)) {
        err.textContent = 'Readiness must be a number between 0 and 1.';
        return;
      }
      readiness = Math.max(0, Math.min(1, readiness));
      readinessInput.value = String(readiness);

      vscode.postMessage({
        type: 'updateNode',
        payload: {
          id: n.id,
          changes: {
            title,
            status,
            readiness,
            body: n.body
          }
        }
      });
    };
    document.getElementById('open').onclick = () => {
      vscode.postMessage({ type: 'openFile', payload: { filePath: n.filePath }});
    };
  }

  function renderGraph() {
    const n = byId[selected];
    if (!n) { graph.innerHTML = ''; return; }

    const width = graph.clientWidth || 600;
    if (!graph.clientWidth) { try { postLog('warn', 'graph.clientWidth is 0; using fallback 600'); } catch (_) {} }
    const height = 300;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);

    // Build nodes and links for interactive SVG
    const nodesArr = [];
    const linksArr = [];

    const addNode = (id, title, status, x, y, role) => {
      nodesArr.push({ id, title, status, x, y, role });
    };
    const addLink = (source, target) => {
      linksArr.push({ source, target });
    };

    // Center (selected) node
    addNode(n.id, n.title, n.status, centerX, centerY, 'self');

    // Parent (above)
    if (n.parent && byId[n.parent]) {
      addNode(n.parent, byId[n.parent].title, byId[n.parent].status, centerX, centerY - 90, 'parent');
      addLink(n.parent, n.id);
    }

    // Children (below, distributed horizontally)
    const children = (Array.isArray(n.children) ? n.children.map(cid => byId[cid]).filter(Boolean) : []);
    const childCount = children.length;
    const childY = centerY + 90;
    const left = 40;
    const right = width - 40;
    children.forEach((c, idx) => {
      const x = childCount > 1 ? Math.floor(left + (idx / (childCount - 1)) * (right - left)) : centerX;
      addNode(c.id, c.title, c.status, x, childY, 'child');
      addLink(n.id, c.id);
    });

    // Create SVG
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.style.border = '1px solid #ccc';
    svg.style.background = '#fff';

    function statusColor(s) {
      switch ((s || '').toLowerCase()) {
        case 'done': return '#2ecc71';
        case 'in-progress': return '#f1c40f';
        case 'blocked': return '#e74c3c';
        case 'planned': return '#95a5a6';
        default: return '#7f8c8d';
      }
    }

    // Links
    linksArr.forEach(l => {
      const from = nodesArr.find(nd => nd.id === l.source);
      const to = nodesArr.find(nd => nd.id === l.target);
      if (!from || !to) return;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(from.x));
      line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x));
      line.setAttribute('y2', String(to.y));
      line.setAttribute('stroke', '#999');
      line.setAttribute('stroke-width', '1.5');
      svg.appendChild(line);
    });

    // Nodes
    nodesArr.forEach(nd => {
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('transform', `translate(${nd.x},${nd.y})`);
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => select(nd.id));

      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('r', nd.role === 'self' ? '16' : '12');
      circle.setAttribute('fill', statusColor(nd.status));
      circle.setAttribute('stroke', '#333');
      circle.setAttribute('stroke-width', '1');
      g.appendChild(circle);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', '0');
      label.setAttribute('y', nd.role === 'self' ? '-20' : '-16');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '12');
      label.setAttribute('fill', '#111');
      label.textContent = nd.title && nd.title.length > 22 ? nd.title.slice(0, 21) + '…' : (nd.title || nd.id);
      g.appendChild(label);

      const idLabel = document.createElementNS(ns, 'text');
      idLabel.setAttribute('x', '0');
      idLabel.setAttribute('y', nd.role === 'self' ? '30' : '26');
      idLabel.setAttribute('text-anchor', 'middle');
      idLabel.setAttribute('font-size', '10');
      idLabel.setAttribute('fill', '#444');
      idLabel.textContent = nd.id;
      g.appendChild(idLabel);

      svg.appendChild(g);
    });

    graph.innerHTML = '';
    graph.appendChild(svg);
  }

  filter.oninput = renderTree;
  if (groupBySel) groupBySel.onchange = renderTree;

  if (rightbar) {
    rightbar.addEventListener('click', ev => {
      const t = ev.target.closest('.pw-item');
      if (!t) return;
      const act = t.getAttribute('data-act');
      const text = t.getAttribute('data-text') || '';
      if (act === 'filter') {
        const needle = (text || '').toLowerCase();
        const match = nodes.find(n =>
          (n.title && n.title.toLowerCase().includes(needle)) ||
          (n.id && n.id.toLowerCase().includes(needle))
        );
        if (match) {
          select(match.id);
        } else {
          filter.value = text;
          renderTree();
        }
      } else if (act === 'explain') {
        const exp = document.getElementById('progressExplain');
        if (exp) {
          let html = text;
          if (window.marked && typeof marked.parse === 'function') {
            try {
              html = marked.parse(text);
              if (window.DOMPurify && typeof DOMPurify.sanitize === 'function') {
                html = DOMPurify.sanitize(html);
              }
            } catch {}
          } else {
            html = escapeHtml(text);
          }
          exp.innerHTML = html;
        }
      }
    });
  }

  if (devbar) {
    devbar.addEventListener('click', ev => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'output') {
        vscode.postMessage({ type: 'showOutput' });
      } else if (act === 'devtools') {
        vscode.postMessage({ type: 'openDevtools' });
      } else if (act === 'reload') {
        vscode.postMessage({ type: 'reloadWebview' });
      }
    });
  }

  window.addEventListener('message', e => {
    if (e.data.type === 'init') {
      postLog('info', 'init received: ' + ((e.data && e.data.payload && e.data.payload.nodes && e.data.payload.nodes.length) || 0) + ' nodes');
      nodes = e.data.payload.nodes;
      rootPath = e.data.payload.rootPath || '';
      memoryDirExists = !!e.data.payload.memoryDirExists;
      memoryDir = e.data.payload.memoryDir || '';
      byId = Object.fromEntries(nodes.map(n => [n.id, n]));
      renderTree();
      // Auto-select first item to ensure diagram is visible on load
      if (!selected && nodes.length) {
        select(nodes[0].id);
      } else {
        renderGraph();
      }
      renderProgressWidget();
    } else if (e.data.type === 'saved') {
      if (e.data.payload && e.data.payload.id === selected) {
        const ok = document.getElementById('ok');
        if (ok) {
          ok.textContent = 'Saved';
          setTimeout(() => { ok.textContent = ''; }, 1500);
        }
      }
      renderProgressWidget();
    }
  });

try { postLog('info', 'webview script loaded'); } catch (e) {}
})();
