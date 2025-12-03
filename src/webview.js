(function(){
  const vscode = acquireVsCodeApi();
  let nodes = [];
  let byId = {};
  let selected = null;
  let rootPath = '';
  let memoryDirExists = true;
  let memoryDir = '';

  const rootEl = document.querySelector('.root');
  const tree = document.getElementById('tree');
  const details = document.getElementById('details');
  const graph = document.getElementById('graph');
  const filter = document.getElementById('filter');
  const groupBySel = document.getElementById('groupBy');
  const themeToggle = document.getElementById('themeToggle');
  const rightbar = document.getElementById('rightbar');
  const splitter = document.getElementById('splitter');
  const progressWidget = document.getElementById('progressWidget');
  const banner = document.getElementById('banner');
  const devbar = document.getElementById('devbar');
  let features = { graphEnabled: true, markdownPreviewEnabled: true };
  let graphRaf = null;
  let sidebarWidth = 280;
  let theme = 'light';
  let lastPrimarySelection = null;

  // Signal readiness so the extension can re-send data after reloads
  try { vscode.postMessage({ type: 'ready' }); } catch (_) {}

  // Restore UI state (selected node, filter, groupBy)
  let __state = {};
  try { __state = vscode.getState ? (vscode.getState() || {}) : {}; } catch(_) { __state = {}; }
  if (filter && __state.filter) filter.value = __state.filter;
  if (groupBySel && __state.groupBy) groupBySel.value = __state.groupBy;
  if (__state.selected) selected = __state.selected;
  if (typeof __state.sidebarWidth === 'number' && Number.isFinite(__state.sidebarWidth)) {
    sidebarWidth = __state.sidebarWidth;
  }
  if (typeof __state.theme === 'string') {
    theme = __state.theme === 'dark' ? 'dark' : 'light';
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    theme = 'dark';
  }

  function saveState() {
    try {
      const st = {
        selected,
        filter: filter ? filter.value : '',
        groupBy: groupBySel ? groupBySel.value : 'none',
        sidebarWidth,
        theme
      };
      vscode.setState && vscode.setState(st);
    } catch (_) {}
  }

  function clampSidebarWidth(px) {
    const min = 200;
    const max = 520;
    const n = Number(px);
    if (!Number.isFinite(n)) return sidebarWidth;
    return Math.max(min, Math.min(max, Math.round(n)));
  }
  function applySidebarWidth(persist = false) {
    sidebarWidth = clampSidebarWidth(sidebarWidth);
    if (rightbar) rightbar.style.width = `${sidebarWidth}px`;
    try { document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`); } catch (_) {}
    if (persist) saveState();
    try { renderGraph(); } catch (_) {}
  }
  applySidebarWidth(false);

  function applyTheme(next, persist = false) {
    theme = next === 'dark' ? 'dark' : 'light';
    try {
      document.documentElement.setAttribute('data-theme', theme);
    } catch (_) {}
    if (themeToggle) {
      themeToggle.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
    }
    if (persist) saveState();
    try { renderGraph(); } catch (_) {}
    try { renderProgressWidget(); } catch (_) {}
  }
  applyTheme(theme, false);

  function postLog(level, message, error) {
    // Append to in-view debug log (if visible)
    try {
      const dbg = document.getElementById('debugLog');
      if (dbg) {
        const line = `[${level}] ${String(message || '')}`;
        dbg.textContent += (dbg.textContent ? '\n' : '') + line;
        dbg.scrollTop = dbg.scrollHeight;
      }
      const info = document.getElementById('debugInfo');
      if (info) info.textContent = new Date().toLocaleTimeString();
    } catch (_) {}
    // Relay to extension OutputChannel
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
    const msg = String(message || '');
    // Ignore benign ResizeObserver loop warnings that VS Code webviews often emit
    if (/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i.test(msg)) {
      postLog('warn', msg + ` at ${source}:${lineno}:${colno}`);
      return true; // handled; suppress banner
    }
    showBanner(`Error: ${msg} (${source}:${lineno}:${colno})`);
    postLog('error', `${msg} at ${source}:${lineno}:${colno}`, error);
    return false;
  };
  window.addEventListener('unhandledrejection', function(ev) {
    const reason = ev && ev.reason ? (ev.reason.message || String(ev.reason)) : 'unhandledrejection';
    // Suppress noisy ResizeObserver loop warnings
    if (/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i.test(String(reason || ''))) {
      postLog('warn', `Unhandled rejection (ignored): ${reason}`);
      return;
    }
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
    if (p && typeof p.body === 'undefined') {
      progressWidget.innerHTML = '<div style="color:#777;">Loading…</div>';
      try { vscode.postMessage({ type: 'fetchBody', payload: { id: p.id } }); } catch (_) {}
      return;
    }
    let html = '';
    if (p) {
      const backlogRaw = sectionLinesFrom(p.body, 'Backlog');
      const inprogRaw = sectionLinesFrom(p.body, 'In Progress');
      const doneRaw = sectionLinesFrom(p.body, 'Done');
      const logRaw = sectionLinesFrom(p.body, 'Log');

      // Build subsystem lookup for tagging
      const subs = nodes.filter(n => (n.type || '').toLowerCase() === 'subsystem');
      const subLookup = new Map();
      subs.forEach(s => {
        subLookup.set((s.id || '').toLowerCase(), s);
        subLookup.set((s.title || '').toLowerCase(), s);
        const parts = (s.id || '').toLowerCase().split(/[-_ ]+/);
        parts.forEach(pt => { if (pt) subLookup.set(pt, s); });
      });
      // Some generic synonyms -> best guess subsystem
      function synonymToSub(key) {
        const k = key.toLowerCase();
        if (k.includes('graph')) return subs.find(s => /graph/.test((s.id||'')+(s.title||'')));
        if (k.includes('webview')) return subs.find(s => /webview/.test((s.id||'')+(s.title||'')));
        if (k.includes('file')) return subs.find(s => /file-?io/.test((s.id||'')+(s.title||'')));
        if (k.includes('tree')) return subs.find(s => /tree/.test((s.id||'')+(s.title||'')));
        if (k.includes('cline')) return subs.find(s => /cline/.test((s.id||'')+(s.title||'')));
        return undefined;
      }

      function parsePrio(t) {
        const m = t.match(/\bP([1-3])\b|\[(P[1-3])\]|\(P([1-3])\)/i);
        if (!m) return null;
        const g = (m[1] || (m[2] && m[2].slice(1)) || m[3] || '').toUpperCase();
        if (!g) return null;
        return g; // 'P1' | 'P2' | 'P3'
      }
      function stripPrio(t) {
        return t.replace(/\s*\[(P[1-3])\]\s*|\s*\(P[1-3]\)\s*|\bP[1-3]\b\s*:?/ig, '').trim();
      }
      function detectTags(t) {
        const tags = new Map();
        const lower = t.toLowerCase();
        // direct id/title and word parts
        for (const key of subLookup.keys()) {
          if (!key) continue;
          if (lower.includes(key)) {
            const sub = subLookup.get(key);
            if (sub) tags.set(sub.id, sub);
          }
        }
        // synonyms
        const syn = synonymToSub(lower);
        if (syn) tags.set(syn.id, syn);
        return Array.from(tags.values());
      }

      function renderChip(txt, cls) {
        return `<span class="chip${cls ? ' ' + cls : ''}">${escapeHtml(txt)}</span>`;
      }

      function mkList(arr, act) {
        if (!arr || arr.length === 0) return '<div style="color:#777;">(empty)</div>';

        const items = arr.map(t => {
          const pr = parsePrio(t);           // 'P1' | 'P2' | 'P3' | null
          const clean = stripPrio(t);        // without priority marker
          const tagSubs = detectTags(clean); // array of subsystems
          return { t, clean, pr, prRank: pr ? Number(pr.slice(1)) : 99, tagSubs };
        });

        // Sort: P1 -> P2 -> P3 -> none; then with tags first
        items.sort((a, b) => (a.prRank - b.prRank) || ((b.tagSubs.length) - (a.tagSubs.length)));

        return items.slice(0, 12).map(it => {
          const right = [
            it.pr ? renderChip(it.pr, 'chip-prio') : '',
            ...it.tagSubs.map(s => `<span class="chip" data-id="${escapeHtml(s.id)}">${escapeHtml(s.title || s.id)}</span>`)
          ].filter(Boolean).join(' ');
          return `
            <div class="pw-item-row">
              <div class="pw-item-text pw-item" data-act="${act}" data-text="${escapeHtml(it.clean)}">
                ${escapeHtml(it.clean)}
              </div>
              <div class="pw-item-tags">${right}</div>
            </div>
          `;
        }).join('');
      }

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
          ${mkList(backlogRaw, 'filter')}
        </div>
        <div class="pw-section">
          <h4>In Progress</h4>
          ${mkList(inprogRaw, 'filter')}
        </div>
        <div class="pw-section">
          <h4>Done (recent)</h4>
          ${mkList(doneRaw, 'explain')}
        </div>
        <div class="pw-section">
          <h4>Log (recent)</h4>
          ${mkList(logRaw, 'explain')}
        </div>
        <div style="margin-top:8px;">
          <div id="progressExplain"></div>
          <div style="margin-top:6px;">
            <button id="progressBack" class="btn-ghost">Back to main view</button>
          </div>
        </div>
      `;
    } else {
      html = '<div style="color:#777;">No progress log found.</div>';
    }
    progressWidget.innerHTML = html;
  }

  const statusPalette = {
    light: {
      done: '#22c55e',
      'in-progress': '#f59e0b',
      blocked: '#ef4444',
      planned: '#9ca3af',
      default: '#6b7280'
    },
    dark: {
      done: '#4ade80',
      'in-progress': '#facc15',
      blocked: '#f87171',
      planned: '#94a3b8',
      default: '#9ca3af'
    }
  };

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
        const row = document.createElement('div');
        row.className = 'tree-row' + (n.id === selected ? ' selected' : '');
        const title = document.createElement('div');
        title.className = 'tree-title';
        title.textContent = n.title;
        title.onclick = () => select(n.id);
        const pct = document.createElement('div');
        pct.className = 'tree-pct';
        pct.textContent = fmtReadiness(n.readiness);
        const status = document.createElement('div');
        status.className = 'tree-status';
        status.textContent = statusIcon(n.status);
        row.appendChild(title);
        row.appendChild(pct);
        row.appendChild(status);
        tree.appendChild(row);
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
        const row = document.createElement('div');
        row.className = 'tree-row' + (n.id === selected ? ' selected' : '');
        row.style.marginLeft = '8px';
        const title = document.createElement('div');
        title.className = 'tree-title';
        title.textContent = n.title;
        title.onclick = () => select(n.id);
        const pct = document.createElement('div');
        pct.className = 'tree-pct';
        pct.textContent = fmtReadiness(n.readiness);
        const status = document.createElement('div');
        status.className = 'tree-status';
        status.textContent = statusIcon(n.status);
        row.appendChild(title);
        row.appendChild(pct);
        row.appendChild(status);
        tree.appendChild(row);
      });
    });
  }

  function select(id) {
    if (selected && selected !== id) {
      lastPrimarySelection = selected;
    }
    selected = id;
    saveState();
    try { renderTree(); } catch (e) { showBanner('renderTree failed'); postLog('error', 'renderTree failed', e); }
    try { renderDetails(); } catch (e) { showBanner('renderDetails failed'); postLog('error', 'renderDetails failed', e); }
    try { renderGraph(); } catch (e) { showBanner('renderGraph failed'); postLog('error', 'renderGraph failed', e); }
  }

  function renderDetails() {
    const n = byId[selected];
    if (!n) { details.innerHTML = 'Select item'; return; }

    details.innerHTML = `
      <div class="detail-header">
        <button id="backMain" class="back-btn" title="Return to main list">← Back to main view</button>
        <div class="detail-title">
          <div style="font-weight:700;">${escapeHtml(n.title)}</div>
          <div class="detail-id"><code>${n.id}</code></div>
        </div>
      </div>
      <div id="err" style="color:#d33;"></div>
      <div id="ok" style="color:#090;"></div>

      <div class="kv">
        <div class="kv-row">
          <div class="kv-label">ID</div>
          <div class="kv-value"><code>${n.id}</code></div>
        </div>
        <div class="kv-row">
          <div class="kv-label">Title</div>
          <div class="kv-value"><input id="t" value="${n.title}"></div>
        </div>
        <div class="kv-row">
          <div class="kv-label">Status</div>
          <div class="kv-value">
            <select id="s">
              <option value="planned"${n.status==='planned'?' selected':''}>planned</option>
              <option value="in-progress"${n.status==='in-progress'?' selected':''}>in-progress</option>
              <option value="blocked"${n.status==='blocked'?' selected':''}>blocked</option>
              <option value="done"${n.status==='done'?' selected':''}>done</option>
            </select>
          </div>
        </div>
        <div class="kv-row">
          <div class="kv-label">Readiness (0–1)</div>
          <div class="kv-value"><input id="r" type="number" min="0" max="1" step="0.01" value="${n.readiness}"></div>
        </div>
        <div class="kv-row">
          <div class="kv-label">Tags</div>
          <div class="kv-value">${Array.isArray(n.tags) ? n.tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join(' ') : ''}</div>
        </div>
      </div>

      <div class="row-actions">
        <button id="save">Save</button>
        <button id="startWork">Start work</button>
        <button id="open">Open File</button>
      </div>

      <div style="margin-top:8px;">
        <b>Content</b>
        <div id="preview" style="border:1px solid #ccc;padding:8px;margin-top:6px;"></div>
      </div>
    `;

    const err = document.getElementById('err');
    const target = document.getElementById('preview');
    const backBtn = document.getElementById('backMain');
    if (backBtn) {
      backBtn.onclick = () => {
        const exp = document.getElementById('progressExplain');
        if (exp) exp.innerHTML = '';
        filter.value = '';
        renderTree();
        if (lastPrimarySelection && byId[lastPrimarySelection]) {
          select(lastPrimarySelection);
        } else if (nodes.length) {
          select(nodes[0].id);
        }
      };
    }
    if (typeof n.body === 'undefined') {
      try { target.textContent = '(loading…)'; } catch (_) {}
      try { vscode.postMessage({ type: 'fetchBody', payload: { id: n.id } }); } catch (_) {}
      return;
    }
    try {
      if (features.markdownPreviewEnabled && window.marked && typeof marked.parse === 'function') {
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
    const startBtn = document.getElementById('startWork');
    if (startBtn) {
      if ((n.status || '').toLowerCase() === 'in-progress') {
        startBtn.disabled = true;
        startBtn.textContent = 'In progress';
      }
      startBtn.onclick = () => {
        err.textContent = '';
        const readinessInput = document.getElementById('r');
        const currentReadiness = Number(readinessInput.value);
        vscode.postMessage({
          type: 'startWork',
          payload: {
            id: n.id,
            readiness: Number.isFinite(currentReadiness) ? currentReadiness : undefined,
            log: `Started ${n.title || n.id}`
          }
        });
      };
    }
    document.getElementById('open').onclick = () => {
      vscode.postMessage({ type: 'openFile', payload: { filePath: n.filePath }});
    };
  }

  function renderGraph() {
    const n = byId[selected];
    if (!n) { graph.innerHTML = ''; return; }
    if (!features.graphEnabled) { graph.innerHTML = ''; return; }

    const width = graph.clientWidth || 600;
    if (!graph.clientWidth) { try { postLog('warn', 'graph.clientWidth is 0; using fallback 600'); } catch (_) {} }
    const height = 300;
    if (width < 10 || height < 50) {
      try { showBanner('Graph area too small; resize the view', 'info'); } catch (_) {}
      graph.innerHTML = '';
      return;
    }
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    let panelBg = '#fff';
    let panelBorder = '#ddd';
    let textColor = '#111';
    let mutedColor = '#444';
    try {
      const style = getComputedStyle(document.documentElement);
      panelBg = (style.getPropertyValue('--panel-bg') || panelBg).trim();
      panelBorder = (style.getPropertyValue('--panel-border') || panelBorder).trim();
      textColor = (style.getPropertyValue('--text') || textColor).trim();
      mutedColor = (style.getPropertyValue('--muted') || mutedColor).trim();
    } catch (_) {}

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
    svg.style.border = `1px solid ${panelBorder}`;
    svg.style.background = panelBg;

    function statusColor(s) {
      const palette = statusPalette[theme] || statusPalette.light;
      const key = (s || '').toLowerCase();
      return palette[key] || palette.default;
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
      line.setAttribute('stroke', panelBorder || '#999');
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
      label.setAttribute('fill', textColor || '#111');
      label.textContent = nd.title && nd.title.length > 22 ? nd.title.slice(0, 21) + '…' : (nd.title || nd.id);
      g.appendChild(label);

      const idLabel = document.createElementNS(ns, 'text');
      idLabel.setAttribute('x', '0');
      idLabel.setAttribute('y', nd.role === 'self' ? '30' : '26');
      idLabel.setAttribute('text-anchor', 'middle');
      idLabel.setAttribute('font-size', '10');
      idLabel.setAttribute('fill', mutedColor || '#444');
      idLabel.textContent = nd.id;
      g.appendChild(idLabel);

      svg.appendChild(g);
    });

    graph.innerHTML = '';
    graph.appendChild(svg);
  }

  filter.oninput = () => { saveState(); renderTree(); };
  if (groupBySel) groupBySel.onchange = () => { saveState(); renderTree(); };

  // Link handling in details preview: internal routes vs external open
  if (details) {
    details.addEventListener('click', ev => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href) return;

      // External http(s)
      if (/^https?:\/\//i.test(href)) {
        ev.preventDefault();
        vscode.postMessage({ type: 'openExternal', payload: { url: href } });
        return;
      }

      // Internal: try id or filename -> id
      let targetId = href.replace(/^#/, '').replace(/\.md$/i, '');
      if (targetId && byId[targetId]) {
        ev.preventDefault();
        select(targetId);
      }
    });
  }

  if (rightbar) {
    rightbar.addEventListener('click', ev => {
      // Chip navigation to subsystem
      const chip = ev.target.closest('.chip');
      if (chip && chip.getAttribute && chip.getAttribute('data-id')) {
        const id = chip.getAttribute('data-id');
        if (id && byId[id]) {
          select(id);
          return;
        }
      }
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
            const secondaryMatch = nodes.find(n =>
              (n.title && n.title.toLowerCase().includes(needle)) ||
              (n.id && n.id.toLowerCase().includes(needle))
            );
            if (secondaryMatch) select(secondaryMatch.id);
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

  // Debug panel controls
  const debugToggle = document.getElementById('debugToggle');
  if (debugToggle) {
    debugToggle.addEventListener('click', () => {
      const pane = document.getElementById('debugPanel');
      if (!pane) return;
      pane.style.display = pane.style.display === 'none' ? 'block' : 'none';
    });
  }
  const debugReload = document.getElementById('debugReload');
  if (debugReload) debugReload.addEventListener('click', () => vscode.postMessage({ type: 'reloadWebview' }));
  const debugCopy = document.getElementById('debugCopy');
  if (debugCopy) debugCopy.addEventListener('click', async () => {
    try {
      const dbg = document.getElementById('debugLog');
      const text = dbg ? dbg.textContent : '';
      await navigator.clipboard.writeText(text || '');
      showBanner('Debug log copied', 'info');
      setTimeout(hideBanner, 1200);
    } catch (_) {
      showBanner('Copy failed');
    }
  });

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      applyTheme(theme === 'dark' ? 'light' : 'dark', true);
    });
  }

  // Sidebar resize
  if (splitter && rootEl && rightbar) {
    let dragging = false;
    const onMove = ev => {
      if (!dragging) return;
      ev.preventDefault();
      const rect = rootEl.getBoundingClientRect();
      const newWidth = rect.right - ev.clientX;
      sidebarWidth = clampSidebarWidth(newWidth);
      applySidebarWidth(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', endDrag);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    splitter.addEventListener('mousedown', ev => {
      dragging = true;
      ev.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', endDrag);
    });
    splitter.addEventListener('dblclick', () => {
      sidebarWidth = 280;
      applySidebarWidth(true);
    });
  }

  // Progress back-to-main
  if (progressWidget) {
    progressWidget.addEventListener('click', ev => {
      const backBtn = ev.target.closest('#progressBack');
      if (!backBtn) return;
      const exp = document.getElementById('progressExplain');
      if (exp) exp.innerHTML = '';
      filter.value = '';
      renderTree();
      if (lastPrimarySelection && byId[lastPrimarySelection]) {
        select(lastPrimarySelection);
      } else if (nodes.length) {
        select(nodes[0].id);
      }
    });
  }

  // Re-render graph on resize
  if (window.ResizeObserver && graph) {
    const ro = new ResizeObserver(() => {
      if (selected) {
        if (graphRaf == null) {
          graphRaf = requestAnimationFrame(() => {
            graphRaf = null;
            try { renderGraph(); } catch (e) { postLog('error', 'renderGraph resize', e); }
          });
        }
      }
    });
    ro.observe(graph);
  }

  window.addEventListener('message', e => {
    if (e.data.type === 'init') {
      postLog('info', 'init received: ' + ((e.data && e.data.payload && e.data.payload.nodes && e.data.payload.nodes.length) || 0) + ' nodes');
      nodes = e.data.payload.nodes;
      rootPath = e.data.payload.rootPath || '';
      memoryDirExists = !!e.data.payload.memoryDirExists;
      memoryDir = e.data.payload.memoryDir || '';
      features = Object.assign({ graphEnabled: true, markdownPreviewEnabled: true }, (e.data.payload && e.data.payload.features) || {});
      byId = Object.fromEntries(nodes.map(n => [n.id, n]));
      renderTree();
      // Restore selection from state if valid; else auto-select first
      if (selected && byId[selected]) {
        select(selected);
      } else if (nodes.length) {
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
    } else if (e.data.type === 'body') {
      const id = e.data.payload && e.data.payload.id;
      const body = e.data.payload && e.data.payload.body;
      if (id && byId[id]) {
        byId[id].body = body || '';
        if (selected === id) {
          try { renderDetails(); } catch (e) { postLog('error', 'renderDetails failed after body load', e); }
        }
        // If progress log arrived, refresh the sidebar
        const p = findProgressNode();
        if (p && p.id === id) {
          try { renderProgressWidget(); } catch (e) { postLog('error', 'renderProgressWidget after body load', e); }
        }
      }
    } else if (e.data.type === 'started') {
      if (e.data.payload && e.data.payload.id === selected) {
        const ok = document.getElementById('ok');
        if (ok) {
          ok.textContent = 'Started and logged';
          setTimeout(() => { ok.textContent = ''; }, 1500);
        }
        // Refresh view to reflect new status
        try { renderTree(); } catch (_) {}
        try { renderDetails(); } catch (_) {}
        try { renderProgressWidget(); } catch (_) {}
      } else {
        // For non-selected, refresh summary lists
        try { renderProgressWidget(); } catch (_) {}
      }
    }
  });

try { postLog('info', 'webview script loaded'); } catch (e) {}
})();
