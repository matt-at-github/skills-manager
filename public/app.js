// ── File tree (rendered from GET /files) ───────────────────────────────

const TYPE_BADGE = {
  instructionFile: { cls: 'badge-claude',  label: 'CLAUDE'  },
  skill:           { cls: 'badge-skill',   label: 'SKILL'   },
  agent:           { cls: 'badge-agents',  label: 'AGENT'   },
  command:         { cls: 'badge-mcp',     label: 'CMD'     },
  settings:        { cls: 'badge-global',  label: 'CFG'     },
  other:           { cls: 'badge-global',  label: 'FILE'    },
};

const FILENAME_BADGE = {
  'AGENTS.md': { cls: 'badge-agents', label: 'AGENTS' },
};

let isCompactMode = true;
let _projectRoots = [];
let _lastFiles = [];
let _instructionNames = ['CLAUDE.md', 'AGENTS.md'];

function makeFolder(name, fullRelPath, isProjectRoot) {
  return { name, fullRelPath, isProjectRoot, files: [], subdirs: new Map() };
}

function buildFolderTree(files, projectRootPaths) {
  const homePfx = /^\/home\/[^/]+/;
  const root = makeFolder('~', '~', false);
  const projectRootRelPaths = new Set(projectRootPaths.map(p => p.replace(homePfx, '~')));

  function ensurePath(relPath) {
    if (relPath === '~') return root;
    const parts = relPath.split('/');
    let node = root;
    let built = '~';
    for (let i = 1; i < parts.length; i++) {
      built += '/' + parts[i];
      if (!node.subdirs.has(parts[i])) {
        node.subdirs.set(parts[i], makeFolder(parts[i], built, projectRootRelPaths.has(built)));
      }
      node = node.subdirs.get(parts[i]);
    }
    return node;
  }

  for (const file of files) {
    const parts = file.relPath.split('/');
    const dirRelPath = parts.slice(0, -1).join('/') || '~';
    ensurePath(dirRelPath).files.push(file);
  }

  for (const absPath of projectRootPaths) {
    const relPath = absPath.replace(homePfx, '~');
    ensurePath(relPath).isProjectRoot = true;
  }

  return root;
}

function isCompactable(node) {
  return node.files.length === 0 && !node.isProjectRoot && node.subdirs.size === 1;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// ── Shared file I/O ────────────────────────────────────────────────────

async function loadFile(filePath) {
  const r = await fetch(`/read?path=${encodeURIComponent(filePath)}`);
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function saveFile(filePath, content, lastMtime) {
  const r = await fetch('/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content, lastMtime }),
  });
  if (r.status === 409) {
    const data = await r.json();
    const err = new Error('conflict');
    err.status = 409;
    err.data = data;
    throw err;
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── File row + inline editor ───────────────────────────────────────────

function renderFileRow(file) {
  const name = file.relPath.split('/').pop();
  const badge = (file.type === 'instructionFile' && FILENAME_BADGE[name]) || TYPE_BADGE[file.type] || TYPE_BADGE.other;

  // Header row
  const nameSpan = el('span', { class: 'file-name' }, [name]);
  const badgeSpan = el('span', { class: `badge ${badge.cls}` }, [badge.label]);
  const dirPath = file.relPath.slice(0, file.relPath.lastIndexOf('/') + 1);
  const pathSpan = el('span', { class: 'file-full-path' }, [dirPath]);
  const nameGroup = el('span', { class: 'file-name-group' }, [badgeSpan, nameSpan, pathSpan]);
  const editModeBtn = el('button', { class: 'btn inline-edit-mode-btn', title: 'Edit inline' }, ['✎']);
  const renderModeBtn = el('button', { class: 'btn inline-render-mode-btn', title: 'Preview' }, ['👁']);
  const popoutBtn = el('button', { class: 'btn inline-popout-btn', title: 'Open in popup editor' }, ['↗']);
  const rowChildren = [nameGroup, editModeBtn, renderModeBtn, popoutBtn];

  const isInRoot = file.type === 'instructionFile' &&
    _projectRoots.some(r => file.path.startsWith(r + '/'));
  if (isInRoot) {
    const delBtn = el('span', { class: 'instr-delete-btn', title: 'Delete ' + name }, ['🗑']);
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); openDeleteModal(file.path); });
    rowChildren.push(delBtn);
  }

  const header = el('div', {
    class: 'file-header',
    dataset: { filePath: file.path, fileType: file.type },
  }, rowChildren);

  // Inline editor
  const textarea = el('textarea', { class: 'inline-textarea', spellcheck: 'false' });
  const renderDiv = el('div', { class: 'inline-render' });
  const statusSpan = el('span', { class: 'inline-status' });
  const saveBtn = el('button', { class: 'btn inline-save-btn' }, ['Save']);
  saveBtn.disabled = true;
  const footer = el('div', { class: 'inline-footer' }, [statusSpan, saveBtn]);
  const inlineEditor = el('div', { class: 'inline-editor' }, [renderDiv, textarea, footer]);

  // Per-instance state
  let mtime = 0;
  let dirty = false;
  let inEditMode = false;
  let savedContent = '';

  function setStatus(text, color = '') {
    statusSpan.textContent = text;
    statusSpan.style.color = color;
  }

  function setDirty(val) {
    dirty = val;
    saveBtn.disabled = !val;
    header.classList.toggle('inline-dirty', val);
    inlineEditor.classList.toggle('inline-dirty', val);
  }

  function autoResize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 500) + 'px';
  }

  function showRender(content) {
    renderDiv.innerHTML = marked.parse(content ?? '');
    renderDiv.style.display = '';
    textarea.style.display = 'none';
    editModeBtn.classList.remove('mode-active');
    renderModeBtn.classList.add('mode-active');
    saveBtn.style.display = 'none';
    inEditMode = false;
  }

  function showEdit() {
    renderDiv.style.display = 'none';
    textarea.style.display = '';
    editModeBtn.classList.add('mode-active');
    renderModeBtn.classList.remove('mode-active');
    saveBtn.style.display = '';
    autoResize();
    textarea.focus();
    inEditMode = true;
  }

  function showHeaderBtns(_visible) { /* visibility handled by CSS hover/expanded */ }

  async function openInline() {
    if (!serverOnline) { alert('Start the skills-manager server first:\n\nnpm start'); return; }
    inlineEditor.classList.add('open');
    header.classList.add('expanded');
    showHeaderBtns(true);
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const dirChildren = header.closest('.tree-node')?.closest('.dir-children');
    const anchor = dirChildren?.previousElementSibling ?? header;
    window.scrollTo({ top: window.scrollY + anchor.getBoundingClientRect().top - remPx * 0.5, behavior: 'smooth' });
    setStatus('loading…');
    saveBtn.disabled = true;
    textarea.value = '';
    renderDiv.innerHTML = '';
    try {
      const data = await loadFile(file.path);
      mtime = data.mtime;
      savedContent = data.content;
      textarea.value = data.content;
      setStatus('');
      setDirty(false);
      showRender(data.content);
    } catch (e) {
      if (e.status === 404) { setStatus('File not found on disk.', '#f85149'); return; }
      if (e.status === 403) { setStatus('Access denied.', '#f85149'); return; }
      setStatus(`Error: ${e.message}`, '#f85149');
    }
  }

  async function closeInline(force = false) {
    if (!force && dirty) {
      const confirmed = await confirmDiscard();
      if (!confirmed) return false;
    }
    inlineEditor.classList.remove('open');
    header.classList.remove('expanded');
    showHeaderBtns(false);
    setDirty(false);
    textarea.value = '';
    renderDiv.innerHTML = '';
    setStatus('');
    inEditMode = false;
    return true;
  }

  async function doSave() {
    if (!dirty) return;
    const content = textarea.value;
    setStatus('saving…');
    saveBtn.disabled = true;
    try {
      const data = await saveFile(file.path, content, mtime);
      mtime = data.mtime;
      savedContent = content;
      setDirty(false);
      setStatus('saved ✓', '#3fb950');
      setTimeout(() => setStatus(''), 2000);
      showRender(content);
    } catch (e) {
      if (e.status === 409) {
        saveBtn.disabled = false;
        openConflictModal(
          content,
          e.data.currentContent,
          e.data.currentMtime,
          async (resolvedContent) => {
            try {
              const d = await saveFile(file.path, resolvedContent, e.data.currentMtime);
              mtime = d.mtime;
              textarea.value = resolvedContent;
              setDirty(false);
              setStatus('saved ✓', '#3fb950');
              setTimeout(() => setStatus(''), 2000);
              showRender(resolvedContent);
            } catch (err) {
              setStatus(`Error: ${err.message}`, '#f85149');
              saveBtn.disabled = false;
            }
          },
          (theirContent) => {
            mtime = e.data.currentMtime;
            textarea.value = theirContent;
            setDirty(false);
            setStatus('');
            showRender(theirContent);
          },
        );
        return;
      }
      setStatus(`Error: ${e.message}`, '#f85149');
      saveBtn.disabled = false;
    }
  }

  // Wire up events
  textarea.addEventListener('input', () => { setDirty(true); autoResize(); });
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); doSave(); }
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!dirty) { showRender(textarea.value); return; }
      confirmDiscard().then(confirmed => {
        if (confirmed) { textarea.value = savedContent; setDirty(false); showRender(savedContent); }
      });
    }
  });
  renderDiv.addEventListener('dblclick', (e) => { e.stopPropagation(); showEdit(); });
  saveBtn.addEventListener('click', doSave);
  editModeBtn.addEventListener('click', (e) => { e.stopPropagation(); showEdit(); });
  renderModeBtn.addEventListener('click', (e) => { e.stopPropagation(); showRender(textarea.value); });
  popoutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openFileEditor(name, file.path, inEditMode ? textarea.value : null, inEditMode ? mtime : null);
    closeInline(true);
  });

  header.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (inlineEditor.classList.contains('open')) {
      await closeInline();
    } else {
      openInline();
    }
  });

  return el('div', { class: 'tree-node' }, [
    el('div', { class: 'tree-row' }, [el('div', { class: 'file-node' }, [header])]),
    inlineEditor,
  ]);
}

function renderFolderChildren(node) {
  const items = [];
  const sorted = [...node.files].sort((a, b) => a.relPath.localeCompare(b.relPath));
  for (const file of sorted) items.push(renderFileRow(file));

  if (node.isProjectRoot) {
    const absPath = _projectRoots.find(p => p.replace(/^\/home\/[^/]+/, '~') === node.fullRelPath);
    if (absPath) {
      for (const fname of _instructionNames) {
        if (!node.files.find(f => f.path === absPath + '/' + fname)) {
          const btn = el('button', { class: 'create-instr-btn' }, ['+ ' + fname]);
          btn.addEventListener('click', () => createInstructionFile(absPath, fname));
          items.push(el('div', { class: 'tree-node' }, [el('div', { class: 'tree-row' }, [btn])]));
        }
      }
    }
  }

  const subdirsSorted = [...node.subdirs.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, sub] of subdirsSorted) items.push(renderFolderNode(sub));
  return items;
}

function makeFolderHeader(name, isProjectRoot) {
  const label = (isProjectRoot ? '◈ ' : '') + name;
  return el('div', { class: 'dir-row', onclick: (e) => toggle(e.currentTarget) }, [
    el('span', { class: 'toggle-icon' }, ['▾']),
    el('span', { class: 'dir-label' }, [
      el('span', { class: `dir-name${isProjectRoot ? ' project-root-name' : ''}` }, [label]),
    ]),
  ]);
}

function renderFolderNode(node) {
  if (isCompactMode && isCompactable(node)) return renderCompactChain(node);
  const header = makeFolderHeader(node.name, node.isProjectRoot);
  const children = el('div', { class: 'dir-children' }, renderFolderChildren(node));
  return el('div', { class: 'tree-node' }, [header, children]);
}

function renderCompactChain(startNode) {
  const chainNodes = [startNode];
  let cur = startNode;
  while (isCompactable(cur)) {
    cur = cur.subdirs.values().next().value;
    chainNodes.push(cur);
  }
  const leafNode = chainNodes[chainNodes.length - 1];
  const hasRoot = chainNodes.some(n => n.isProjectRoot);
  const chainLabel = (hasRoot ? '◈ ' : '') + chainNodes.map(n => n.name).join('/') + '/';

  const expandBtn = el('span', { class: 'compact-expand-btn', title: 'Expand path' }, ['⋯']);
  const header = el('div', { class: 'dir-row compact-chain', onclick: (e) => toggle(e.currentTarget) }, [
    el('span', { class: 'toggle-icon' }, ['▾']),
    el('span', { class: 'dir-label' }, [
      el('span', { class: `dir-name${hasRoot ? ' project-root-name' : ''}` }, [chainLabel]),
    ]),
    expandBtn,
  ]);

  const leafChildren = el('div', { class: 'dir-children' }, renderFolderChildren(leafNode));
  const wrapper = el('div', { class: 'tree-node' }, [header, leafChildren]);

  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    let inner = leafChildren;
    for (let i = chainNodes.length - 1; i >= 0; i--) {
      const n = chainNodes[i];
      const hdr = makeFolderHeader(n.name, n.isProjectRoot);
      const childDiv = i === chainNodes.length - 1
        ? inner
        : el('div', { class: 'dir-children' }, [inner]);
      inner = el('div', { class: 'tree-node' }, [hdr, childDiv]);
    }
    wrapper.replaceWith(inner);
  });

  return wrapper;
}

function renderTree(files, projectRoots = []) {
  _projectRoots = projectRoots;
  _lastFiles = files;
  const tree = document.getElementById('tree');
  tree.replaceChildren();

  if (files.length === 0 && projectRoots.length === 0) {
    tree.appendChild(el('div', { class: 'tree-loading' }, ['No files found in allowlist.']));
    return;
  }

  const root = buildFolderTree(files, projectRoots);
  const rootHeader = el('div', { class: 'dir-row', onclick: (e) => toggle(e.currentTarget) }, [
    el('span', { class: 'toggle-icon' }, ['▾']),
    el('span', { class: 'dir-label' }, [el('span', { class: 'dir-name' }, ['~'])]),
  ]);
  const rootChildren = el('div', { class: 'dir-children' }, renderFolderChildren(root));
  tree.appendChild(el('div', { class: 'tree-node tree-root' }, [rootHeader, rootChildren]));
}

function toggleCompactMode() {
  isCompactMode = !isCompactMode;
  const btn = document.getElementById('compact-toggle');
  if (btn) btn.textContent = isCompactMode ? 'full paths' : 'compact paths';
  renderTree(_lastFiles, _projectRoots);
}

async function loadFiles() {
  const tree = document.getElementById('tree');
  tree.replaceChildren(el('div', { class: 'tree-loading' }, ['loading…']));
  try {
    const r = await fetch('/files');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    _instructionNames = body.instructionNames ?? ['CLAUDE.md', 'AGENTS.md'];
    renderTree(body.files, body.projectRoots ?? []);
  } catch (e) {
    tree.replaceChildren(
      el('div', { class: 'tree-loading' }, [`Error loading files: ${e.message}`]),
    );
  }
}

// ── Tree expand/collapse ───────────────────────────────────────────────

function expandAll() {
  document.querySelectorAll('.dir-children').forEach((c) => c.classList.remove('collapsed'));
  document.querySelectorAll('.dir-row').forEach((r) => r.classList.remove('collapsed'));
}

function collapseAll() {
  document.querySelectorAll('.dir-children').forEach((c) => c.classList.add('collapsed'));
  document.querySelectorAll('.dir-row').forEach((r) => r.classList.add('collapsed'));
}

function toggle(dirRow) {
  const parent = dirRow.parentElement;
  const children = parent.querySelector('.dir-children');
  if (!children) return;
  const isCollapsed = children.classList.contains('collapsed');
  children.classList.toggle('collapsed', !isCollapsed);
  dirRow.classList.toggle('collapsed', !isCollapsed);
}

// ── Discard modal ─────────────────────────────────────────────────────

let _discardResolveHandler = null;

function _resolveDiscard(confirmed) {
  document.getElementById('discard-modal-overlay').classList.remove('open');
  if (_discardResolveHandler) { _discardResolveHandler(confirmed); _discardResolveHandler = null; }
}

function confirmDiscard() {
  return new Promise((resolve) => {
    _discardResolveHandler = resolve;
    document.getElementById('discard-modal-overlay').classList.add('open');
  });
}

// ── Server status ──────────────────────────────────────────────────────

let serverOnline = false;

async function checkServer() {
  const dot = document.getElementById('server-dot');
  const txt = document.getElementById('server-status-text');
  try {
    const r = await fetch('/files', { signal: AbortSignal.timeout(1500) });
    serverOnline = r.ok;
    dot.className = 'server-dot online';
    txt.textContent = 'editor server online';
  } catch {
    serverOnline = false;
    dot.className = 'server-dot offline';
    txt.textContent = 'start server: node src/server.js';
  }
}

function markEditableFiles() {
  // no-op: buttons rendered inline in renderFileRow
}

// ── Toast ──────────────────────────────────────────────────────────────

function showToast(message, type = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3500);
}

// ── Popup editor ───────────────────────────────────────────────────────

let _currentPath = '';
let _lastMtime = 0;

function set404Actions(show) {
  document.getElementById('skill-modal-404-actions').style.display = show ? '' : 'none';
  document.querySelector('.modal-btn-save').style.display = show ? 'none' : '';
}

function removeFileFromList() {
  closeSkillEditor();
  loadFiles();
}

async function openFileEditor(name, filePath, prefillContent = null, prefillMtime = null) {
  if (!serverOnline) {
    alert('Start the skills-manager server first:\n\nnpm start');
    return;
  }
  _currentPath = filePath;
  document.getElementById('skill-modal-name').textContent = name;
  document.getElementById('skill-modal-path').textContent = filePath;
  const status = document.getElementById('skill-modal-status');
  status.textContent = '';
  status.style.color = '';
  document.getElementById('skill-modal-textarea').value = '';
  document.getElementById('skill-modal-overlay').classList.add('open');
  document.querySelector('.modal-btn-save').disabled = true;
  set404Actions(false);

  if (prefillContent !== null) {
    _lastMtime = prefillMtime ?? 0;
    document.getElementById('skill-modal-textarea').value = prefillContent;
    document.querySelector('.modal-btn-save').disabled = false;
    document.getElementById('skill-modal-textarea').focus();
    return;
  }

  status.textContent = 'loading…';
  try {
    const data = await loadFile(filePath);
    _lastMtime = data.mtime;
    document.getElementById('skill-modal-textarea').value = data.content;
    status.textContent = '';
    document.querySelector('.modal-btn-save').disabled = false;
    document.getElementById('skill-modal-textarea').focus();
  } catch (e) {
    if (e.status === 404) {
      status.style.color = '#f85149';
      status.textContent = 'File not found on disk.';
      set404Actions(true);
      return;
    }
    if (e.status === 403) {
      closeSkillEditor();
      showToast('Access denied: path not in allowlist.');
      return;
    }
    status.style.color = '#f85149';
    status.textContent = `Error loading: ${e.message}`;
  }
}

function closeSkillEditor() {
  document.getElementById('skill-modal-overlay').classList.remove('open');
  set404Actions(false);
  _currentPath = '';
  _lastMtime = 0;
  // reset preview state
  document.getElementById('skill-modal-render').style.display = 'none';
  document.getElementById('skill-modal-textarea').style.display = '';
  const pvBtn = document.querySelector('.modal-btn-preview');
  if (pvBtn) pvBtn.textContent = '👁 Preview';
}

function toggleModalPreview() {
  const textarea = document.getElementById('skill-modal-textarea');
  const renderDiv = document.getElementById('skill-modal-render');
  const pvBtn = document.querySelector('.modal-btn-preview');
  const isPreviewing = renderDiv.style.display !== 'none';
  if (isPreviewing) {
    renderDiv.style.display = 'none';
    textarea.style.display = '';
    pvBtn.textContent = '👁 Preview';
  } else {
    renderDiv.innerHTML = marked.parse(textarea.value ?? '');
    renderDiv.style.display = '';
    textarea.style.display = 'none';
    pvBtn.textContent = '✎ Edit';
  }
}

async function saveSkill() {
  if (!_currentPath) return;
  const content = document.getElementById('skill-modal-textarea').value;
  const status = document.getElementById('skill-modal-status');
  const saveBtn = document.querySelector('.modal-btn-save');
  status.textContent = 'saving…';
  status.style.color = '';
  saveBtn.disabled = true;
  try {
    const data = await saveFile(_currentPath, content, _lastMtime);
    _lastMtime = data.mtime;
    status.style.color = '#3fb950';
    status.textContent = 'saved ✓';
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 2000);
  } catch (e) {
    if (e.status === 409) {
      saveBtn.disabled = false;
      openConflictModal(
        content,
        e.data.currentContent,
        e.data.currentMtime,
        async (resolvedContent) => {
          status.textContent = 'saving…';
          status.style.color = '';
          saveBtn.disabled = true;
          try {
            const d = await saveFile(_currentPath, resolvedContent, e.data.currentMtime);
            _lastMtime = d.mtime;
            document.getElementById('skill-modal-textarea').value = resolvedContent;
            status.style.color = '#3fb950';
            status.textContent = 'saved ✓';
            saveBtn.disabled = false;
            setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 2000);
          } catch (err) {
            status.style.color = '#f85149';
            status.textContent = `Error: ${err.message}`;
            saveBtn.disabled = false;
          }
        },
        (theirContent) => {
          _lastMtime = e.data.currentMtime;
          document.getElementById('skill-modal-textarea').value = theirContent;
          status.style.color = '';
          status.textContent = '';
          saveBtn.disabled = false;
        },
      );
      return;
    }
    status.style.color = '#f85149';
    status.textContent = `Error: ${e.message}`;
    saveBtn.disabled = false;
  }
}

// ── Conflict modal ─────────────────────────────────────────────────────

let _conflictServerMtime = 0;
let _onConflictKeep = null;
let _onConflictDiscard = null;

function openConflictModal(myContent, theirContent, serverMtime, onKeep, onDiscard) {
  _conflictServerMtime = serverMtime;
  _onConflictKeep = onKeep;
  _onConflictDiscard = onDiscard;
  document.getElementById('conflict-mine').value = myContent;
  document.getElementById('conflict-mine').readOnly = true;
  document.getElementById('conflict-theirs').value = theirContent;
  document.getElementById('conflict-footer-default').style.display = '';
  document.getElementById('conflict-footer-merge').style.display = 'none';
  document.getElementById('conflict-modal-overlay').classList.add('open');
}

function closeConflictModal() {
  document.getElementById('conflict-modal-overlay').classList.remove('open');
}

async function keepMine() {
  const content = document.getElementById('conflict-mine').value;
  closeConflictModal();
  if (_onConflictKeep) await _onConflictKeep(content);
}

function discardMine() {
  const theirContent = document.getElementById('conflict-theirs').value;
  closeConflictModal();
  if (_onConflictDiscard) _onConflictDiscard(theirContent);
}

function openBoth() {
  document.getElementById('conflict-mine').readOnly = false;
  document.getElementById('conflict-mine').focus();
  document.getElementById('conflict-footer-default').style.display = 'none';
  document.getElementById('conflict-footer-merge').style.display = '';
}

async function saveMerged() {
  const content = document.getElementById('conflict-mine').value;
  closeConflictModal();
  if (_onConflictKeep) await _onConflictKeep(content);
}

// ── Delete modal ────────────────────────────────────────────────────────

let _deleteFilePath = '';
let _deleteMode = 'trash';

function openDeleteModal(filePath) {
  _deleteFilePath = filePath;
  _deleteMode = 'trash';
  const nameEl = document.getElementById('delete-confirm-name');
  if (nameEl) nameEl.textContent = filePath.split('/').pop();
  document.getElementById('delete-modal-path').textContent = filePath;
  const confirmInput = document.getElementById('delete-confirm-input');
  if (confirmInput) confirmInput.value = '';
  const radios = document.querySelectorAll("input[name='delete-mode']");
  radios.forEach((r) => { r.checked = r.value === 'trash'; });
  document.getElementById('delete-confirm-row').style.display = 'none';
  const btn = document.getElementById('delete-btn-confirm');
  if (btn) btn.disabled = false;
  document.getElementById('delete-modal-status').textContent = '';
  document.getElementById('delete-modal-overlay').classList.add('open');
}

function closeDeleteModal() {
  document.getElementById('delete-modal-overlay').classList.remove('open');
  _deleteFilePath = '';
}

function setDeleteMode(mode) {
  _deleteMode = mode;
  const row = document.getElementById('delete-confirm-row');
  const btn = document.getElementById('delete-btn-confirm');
  if (mode === 'hard') {
    row.style.display = '';
    if (btn) btn.disabled = true;
    const input = document.getElementById('delete-confirm-input');
    if (input) input.value = '';
  } else {
    row.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

function checkDeleteConfirm() {
  const input = document.getElementById('delete-confirm-input');
  const btn = document.getElementById('delete-btn-confirm');
  const name = _deleteFilePath.split('/').pop();
  if (btn) btn.disabled = input.value !== name;
}

async function doDelete() {
  const status = document.getElementById('delete-modal-status');
  const btn = document.getElementById('delete-btn-confirm');
  if (btn) btn.disabled = true;
  status.textContent = 'deleting…';
  try {
    const r = await fetch('/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: _deleteFilePath, mode: _deleteMode }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      status.style.color = '#f85149';
      status.textContent = `Error: ${data.error ?? r.status}`;
      if (btn) btn.disabled = false;
      return;
    }
    _lastFiles = _lastFiles.filter(f => f.path !== _deleteFilePath);
    const header = document.querySelector(`.file-header[data-file-path="${CSS.escape(_deleteFilePath)}"]`);
    if (header) {
      header.closest('.tree-node')?.remove();
    }
    closeDeleteModal();
  } catch (e) {
    status.style.color = '#f85149';
    status.textContent = `Error: ${e.message}`;
    if (btn) btn.disabled = false;
  }
}

// ── Config panel ───────────────────────────────────────────────────────

let _cfg = { files: [], directories: [], projectRoots: [] };

function renderConfigBody() {
  const body = document.getElementById('config-modal-body');
  body.replaceChildren();

  function section(title, items, renderItem, addRow) {
    const heading = el('div', { class: 'cfg-section-title' }, [title]);
    const list = el('div', { class: 'cfg-list' }, items.map(renderItem));
    const add = el('div', { class: 'cfg-add-row' }, addRow);
    body.appendChild(el('div', { class: 'cfg-section' }, [heading, list, add]));
  }

  section('Files', _cfg.files,
    (f, i) => el('div', { class: 'cfg-item' }, [
      el('span', { class: 'cfg-item-text' }, [f]),
      el('button', { class: 'cfg-remove-btn', onclick: () => { _cfg.files.splice(i, 1); renderConfigBody(); } }, ['✕']),
    ]),
    [
      el('input', { class: 'cfg-input', id: 'cfg-file-input', placeholder: '/path/to/CLAUDE.md or ~/...' }),
      el('button', { class: 'modal-btn cfg-add-btn', onclick: () => {
        const v = document.getElementById('cfg-file-input').value.trim();
        if (v) { _cfg.files.push(v); renderConfigBody(); }
      }}, ['Add']),
    ]
  );

  section('Directories', _cfg.directories,
    (d, i) => el('div', { class: 'cfg-item' }, [
      el('span', { class: 'cfg-item-text' }, [`${d.path}  ${d.extensions.join(', ')}`]),
      el('button', { class: 'cfg-remove-btn', onclick: () => { _cfg.directories.splice(i, 1); renderConfigBody(); } }, ['✕']),
    ]),
    [
      el('input', { class: 'cfg-input cfg-input-sm', id: 'cfg-dir-path', placeholder: 'path' }),
      el('input', { class: 'cfg-input cfg-input-sm', id: 'cfg-dir-exts', placeholder: '.md, .txt' }),
      el('button', { class: 'modal-btn cfg-add-btn', onclick: () => {
        const p = document.getElementById('cfg-dir-path').value.trim();
        const exts = document.getElementById('cfg-dir-exts').value.split(',').map((s) => s.trim()).filter(Boolean);
        if (p && exts.length) { _cfg.directories.push({ path: p, extensions: exts }); renderConfigBody(); }
      }}, ['Add']),
    ]
  );

  section('Project Roots', _cfg.projectRoots,
    (r, i) => el('div', { class: 'cfg-item' }, [
      el('span', { class: 'cfg-item-text' }, [r]),
      el('button', { class: 'cfg-remove-btn', onclick: () => { _cfg.projectRoots.splice(i, 1); renderConfigBody(); } }, ['✕']),
    ]),
    [
      el('input', { class: 'cfg-input', id: 'cfg-root-input', placeholder: '~/projects/myapp' }),
      el('button', { class: 'modal-btn cfg-add-btn', onclick: () => {
        const v = document.getElementById('cfg-root-input').value.trim();
        if (v) { _cfg.projectRoots.push(v); renderConfigBody(); }
      }}, ['Add']),
    ]
  );
}

async function openConfigPanel() {
  if (!serverOnline) {
    alert('Start the skills-manager server first:\n\nnpm start');
    return;
  }
  document.getElementById('config-modal-status').textContent = 'loading…';
  document.getElementById('config-modal-status').style.color = '';
  document.getElementById('config-modal-overlay').classList.add('open');
  document.getElementById('config-modal-body').replaceChildren();
  try {
    const r = await fetch('/config');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _cfg = {
      files: [...(data.files ?? [])],
      directories: (data.directories ?? []).map((d) => ({ ...d, extensions: [...d.extensions] })),
      projectRoots: [...(data.projectRoots ?? [])],
    };
    document.getElementById('config-modal-status').textContent = '';
    renderConfigBody();
  } catch (e) {
    document.getElementById('config-modal-status').style.color = '#f85149';
    document.getElementById('config-modal-status').textContent = `Error: ${e.message}`;
  }
}

function closeConfigPanel() {
  document.getElementById('config-modal-overlay').classList.remove('open');
}

async function saveConfig() {
  const status = document.getElementById('config-modal-status');
  const saveBtn = document.querySelector('.config-btn-save');
  status.textContent = 'saving…';
  status.style.color = '';
  saveBtn.disabled = true;
  try {
    const r = await fetch('/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_cfg),
    });
    const data = await r.json();
    if (!r.ok) {
      status.style.color = '#f85149';
      status.textContent = data.error ?? `Error ${r.status}`;
      return;
    }
    status.style.color = '#3fb950';
    status.textContent = 'saved ✓';
    setTimeout(() => closeConfigPanel(), 800);
    loadFiles();
  } catch (e) {
    status.style.color = '#f85149';
    status.textContent = `Error: ${e.message}`;
  } finally {
    saveBtn.disabled = false;
  }
}

async function createInstructionFile(projectRoot, filename) {
  try {
    const r = await fetch('/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectRoot, filename }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      showToast(`Create failed: ${data.error ?? r.status}`);
      return;
    }
    await loadFiles();
  } catch (e) {
    showToast(`Create failed: ${e.message}`);
  }
}

document.addEventListener('keydown', (e) => {
  if (document.getElementById('skill-modal-overlay').classList.contains('open')) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveSkill();
    }
    if (e.key === 'Escape') closeSkillEditor();
  }
  if (e.key === 'Escape' && document.getElementById('delete-modal-overlay').classList.contains('open')) {
    closeDeleteModal();
  }
  if (e.key === 'Escape' && document.getElementById('discard-modal-overlay').classList.contains('open')) {
    _resolveDiscard(false);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _currentPath) {
    const name = document.getElementById('skill-modal-name').textContent;
    openFileEditor(name, _currentPath);
  }
});

// Init
checkServer();
loadFiles();
