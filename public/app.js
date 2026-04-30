function expandAll() {
  document.querySelectorAll('.dir-children').forEach(c => c.classList.remove('collapsed'));
  document.querySelectorAll('.dir-row').forEach(r => r.classList.remove('collapsed'));
  document.querySelectorAll('.subsection-children').forEach(c => c.classList.remove('collapsed'));
  document.querySelectorAll('.subsection-row').forEach(r => r.classList.remove('collapsed'));
  document.querySelectorAll('.file-content').forEach(c => c.classList.add('open'));
  document.querySelectorAll('.file-header').forEach(h => h.classList.add('expanded'));
}

function collapseAll() {
  document.querySelectorAll('.dir-children').forEach(c => c.classList.add('collapsed'));
  document.querySelectorAll('.dir-row').forEach(r => r.classList.add('collapsed'));
  document.querySelectorAll('.subsection-children').forEach(c => c.classList.add('collapsed'));
  document.querySelectorAll('.subsection-row').forEach(r => r.classList.add('collapsed'));
  document.querySelectorAll('.file-content').forEach(c => c.classList.remove('open'));
  document.querySelectorAll('.file-header').forEach(h => h.classList.remove('expanded'));
  document.querySelectorAll('.raw-content').forEach(c => c.classList.remove('open'));
  document.querySelectorAll('.raw-toggle').forEach(t => t.textContent = 'show raw ▾');
}

function toggle(dirRow) {
  const parent = dirRow.parentElement;
  const children = parent.querySelector('.dir-children');
  if (!children) return;
  const isCollapsed = children.classList.contains('collapsed');
  children.classList.toggle('collapsed', !isCollapsed);
  dirRow.classList.toggle('collapsed', !isCollapsed);
}

function toggleSub(subRow) {
  const parent = subRow.parentElement;
  const children = parent.querySelector('.subsection-children');
  if (!children) return;
  const isCollapsed = children.classList.contains('collapsed');
  children.classList.toggle('collapsed', !isCollapsed);
  subRow.classList.toggle('collapsed', !isCollapsed);
}

function toggleFile(header) {
  const content = header.nextElementSibling;
  if (!content) return;
  const isOpen = content.classList.contains('open');
  content.classList.toggle('open', !isOpen);
  header.classList.toggle('expanded', !isOpen);
}

function toggleRaw(toggle) {
  const raw = toggle.nextElementSibling;
  if (!raw) return;
  const isOpen = raw.classList.contains('open');
  raw.classList.toggle('open', !isOpen);
  toggle.textContent = isOpen ? 'show raw ▾' : 'hide raw ▴';
}

// ── File editor ──────────────────────────────────────────────────────────

const SERVER = 'http://localhost:7842';
let serverOnline = false;

async function checkServer() {
  const dot = document.getElementById('server-dot');
  const txt = document.getElementById('server-status-text');
  try {
    const r = await fetch(`${SERVER}/`, { signal: AbortSignal.timeout(1500) });
    serverOnline = r.ok || r.status === 404;
    dot.className = 'server-dot online';
    txt.textContent = 'editor server online · click ✎ to edit any file';
    markEditableFiles();
  } catch {
    serverOnline = false;
    dot.className = 'server-dot offline';
    txt.textContent = 'start server: node src/server.js';
  }
}

function markEditableFiles() {
  document.querySelectorAll('.file-header[data-file-path]').forEach(header => {
    if (header.classList.contains('fn-symlink') || header.querySelector('.fn-symlink')) return;
    if (header.classList.contains('fn-deprecated') || header.querySelector('.fn-deprecated')) return;
    if (header.querySelector('.file-edit-btn')) return; // already added
    const path = header.dataset.filePath;
    const displayName = path.split('/').pop();
    const btn = document.createElement('span');
    btn.className = 'file-edit-btn';
    btn.textContent = '✎';
    btn.title = 'Edit ' + displayName;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openFileEditor(displayName, path);
    });
    header.appendChild(btn);
  });
}

let _currentPath = '';

async function openFileEditor(name, path) {
  if (!serverOnline) {
    alert('Start the skill editor server first:\n\nnode src/server.js');
    return;
  }
  _currentPath = path;
  document.getElementById('skill-modal-name').textContent = name;
  document.getElementById('skill-modal-path').textContent = path;
  document.getElementById('skill-modal-status').textContent = 'loading…';
  document.getElementById('skill-modal-textarea').value = '';
  document.getElementById('skill-modal-overlay').classList.add('open');
  document.querySelector('.modal-btn-save').disabled = true;

  try {
    const r = await fetch(`${SERVER}/read?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    document.getElementById('skill-modal-textarea').value = data.content;
    document.getElementById('skill-modal-status').textContent = '';
    document.querySelector('.modal-btn-save').disabled = false;
    document.getElementById('skill-modal-textarea').focus();
  } catch (e) {
    document.getElementById('skill-modal-status').textContent = `Error loading: ${e.message}`;
  }
}

function closeSkillEditor() {
  document.getElementById('skill-modal-overlay').classList.remove('open');
  _currentPath = '';
}

async function saveSkill() {
  if (!_currentPath) return;
  const content = document.getElementById('skill-modal-textarea').value;
  const status = document.getElementById('skill-modal-status');
  const saveBtn = document.querySelector('.modal-btn-save');
  status.textContent = 'saving…';
  saveBtn.disabled = true;
  try {
    const r = await fetch(`${SERVER}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: _currentPath, content }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    status.style.color = '#3fb950';
    status.textContent = 'saved ✓';
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 2000);
  } catch (e) {
    status.style.color = '#f85149';
    status.textContent = `Error: ${e.message}`;
  } finally {
    saveBtn.disabled = false;
  }
}

// Keyboard shortcut: Ctrl+S / Cmd+S inside modal
document.addEventListener('keydown', e => {
  if (document.getElementById('skill-modal-overlay').classList.contains('open')) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveSkill();
    }
    if (e.key === 'Escape') closeSkillEditor();
  }
});

// Init
checkServer();
