(function(){
  const vscode = acquireVsCodeApi();
  let nodes = [];
  let byId = {};
  let selected = null;

  const tree = document.getElementById('tree');
  const details = document.getElementById('details');
  const graph = document.getElementById('graph');
  const filter = document.getElementById('filter');

  function renderTree() {
    const f = filter.value.toLowerCase();
    tree.innerHTML = '';
    nodes.forEach(n => {
      if (f && !n.title.toLowerCase().includes(f)) return;
      const div = document.createElement('div');
      div.textContent = n.title;
      div.style.cursor = 'pointer';
      if (n.id === selected) div.style.fontWeight = 'bold';
      div.onclick = () => select(n.id);
      tree.appendChild(div);
    });
  }

  function select(id) {
    selected = id;
    renderTree();
    renderDetails();
    renderGraph();
  }

  function renderDetails() {
    const n = byId[selected];
    if (!n) { details.innerHTML = 'Select item'; return; }

    details.innerHTML = `
      <div><b>ID:</b> ${n.id}</div>
      <div><b>Title:</b> <input id="t" value="${n.title}"></div>
      <div><b>Status:</b> <input id="s" value="${n.status}"></div>
      <div><b>Readiness:</b> <input id="r" value="${n.readiness}"></div>
      <div><b>Body:</b><br><textarea id="b" rows="6">${n.body}</textarea></div>
      <button id="save">Save</button>
      <button id="open">Open File</button>
      <button id="cline">Ask Cline</button>
    `;

    document.getElementById('save').onclick = () => {
      vscode.postMessage({
        type: 'updateNode',
        payload: {
          id: n.id,
          changes: {
            title: document.getElementById('t').value,
            status: document.getElementById('s').value,
            readiness: document.getElementById('r').value,
            body: document.getElementById('b').value
          }
        }
      });
    };
    document.getElementById('open').onclick = () => {
      vscode.postMessage({ type: 'openFile', payload: { filePath: n.filePath }});
    };
    document.getElementById('cline').onclick = () => {
      vscode.postMessage({ type: 'askCline', payload: { id: n.id }});
    };
  }

  function renderGraph() {
    const n = byId[selected];
    if (!n) { graph.innerHTML = ''; return; }
    graph.innerHTML = `<b>Graph:</b> ${n.id}`;
  }

  filter.oninput = renderTree;

  window.addEventListener('message', e => {
    if (e.data.type === 'init') {
      nodes = e.data.payload.nodes;
      byId = Object.fromEntries(nodes.map(n => [n.id, n]));
      renderTree();
    }
  });

})();
