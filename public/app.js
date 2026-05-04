// ── File tree (rendered from GET /files) ───────────────────────────────

const TYPE_GROUPS = [
  { type: "instructionFile", label: "Instruction files", badge: "badge-claude" },
  { type: "skill", label: "Skills", badge: "badge-skill" },
  { type: "agent", label: "Agents", badge: "badge-agents" },
  { type: "command", label: "Commands", badge: "badge-mcp" },
  { type: "settings", label: "Settings", badge: "badge-global" },
  { type: "other", label: "Other", badge: "badge-global" },
];

function groupByType(files) {
  const map = new Map();
  for (const f of files) {
    if (!map.has(f.type)) map.set(f.type, []);
    map.get(f.type).push(f);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }
  return map;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function renderFileRow(file) {
  const header = el(
    "div",
    {
      class: "file-header",
      dataset: { filePath: file.path, fileType: file.type },
      onclick: (e) => {
        e.stopPropagation();
        selectFile(file);
      },
    },
    [
      el("span", { class: "file-name" }, [file.relPath.split("/").pop()]),
      el("span", { class: "scope-tag" }, [file.relPath]),
    ],
  );
  return el("div", { class: "tree-node" }, [
    el("div", { class: "tree-row" }, [el("div", { class: "file-node" }, [header])]),
  ]);
}

function renderGroup(group, files) {
  const header = el(
    "div",
    {
      class: "dir-row",
      onclick: (e) => toggle(e.currentTarget),
    },
    [
      el("span", { class: "toggle-icon" }, ["▾"]),
      el("span", { class: "dir-label" }, [
        el("span", { class: `badge ${group.badge}` }, [group.label]),
        el("span", { class: "scope-tag" }, [`${files.length} file${files.length === 1 ? "" : "s"}`]),
      ]),
    ],
  );
  const children = el(
    "div",
    { class: "dir-children" },
    files.map(renderFileRow),
  );
  return el("div", { class: "tree-node" }, [header, children]);
}

function renderProjectRoot(root, files) {
  const label = root.replace(/^\/home\/[^/]+/, "~") || root;
  const rows = [];
  for (const name of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
    const filePath = root + "/" + name;
    const existing = files.find((f) => f.path === filePath);
    if (existing) {
      const nameSpan = el("span", { class: "file-name" }, [name]);
      const pathSpan = el("span", { class: "scope-tag" }, [existing.relPath]);
      const editBtn = el("span", { class: "file-edit-btn", title: "Edit " + name }, ["✎"]);
      editBtn.addEventListener("click", (e) => { e.stopPropagation(); openFileEditor(name, filePath); });
      const delBtn = el("span", { class: "instr-delete-btn", title: "Delete " + name }, ["🗑"]);
      delBtn.addEventListener("click", (e) => { e.stopPropagation(); openDeleteModal(filePath); });
      const header = el("div", { class: "file-header", dataset: { filePath, fileType: "instructionFile" } }, [nameSpan, pathSpan, editBtn, delBtn]);
      rows.push(el("div", { class: "tree-node" }, [el("div", { class: "tree-row" }, [el("div", { class: "file-node" }, [header])])]));
    } else {
      const btn = el("button", { class: "create-instr-btn" }, ["+ " + name]);
      btn.addEventListener("click", () => createInstructionFile(root, name));
      rows.push(el("div", { class: "tree-node" }, [el("div", { class: "tree-row" }, [btn])]));
    }
  }
  const header = el("div", { class: "dir-row", onclick: (e) => toggle(e.currentTarget) }, [
    el("span", { class: "toggle-icon" }, ["▾"]),
    el("span", { class: "dir-label" }, [
      el("span", { class: "badge badge-global" }, ["PROJECT ROOT"]),
      el("span", { class: "scope-tag" }, [label]),
    ]),
  ]);
  const children = el("div", { class: "dir-children" }, rows);
  return el("div", { class: "tree-node" }, [header, children]);
}

function renderProjectRootsSection(files, projectRoots) {
  if (!projectRoots || projectRoots.length === 0) return null;
  const container = document.createDocumentFragment();
  for (const root of projectRoots) {
    container.appendChild(renderProjectRoot(root, files));
  }
  const wrapper = document.createElement("div");
  wrapper.appendChild(container);
  return wrapper;
}

async function createInstructionFile(projectRoot, filename) {
  try {
    const r = await fetch("/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

// ── Delete modal ────────────────────────────────────────────────────────

let _deleteFilePath = "";
let _deleteMode = "trash";

function openDeleteModal(filePath) {
  _deleteFilePath = filePath;
  _deleteMode = "trash";
  const nameEl = document.getElementById("delete-confirm-name");
  if (nameEl) nameEl.textContent = filePath.split("/").pop();
  document.getElementById("delete-modal-path").textContent = filePath;
  const confirmInput = document.getElementById("delete-confirm-input");
  if (confirmInput) confirmInput.value = "";
  const radios = document.querySelectorAll("input[name='delete-mode']");
  radios.forEach((r) => { r.checked = r.value === "trash"; });
  document.getElementById("delete-confirm-row").style.display = "none";
  const btn = document.getElementById("delete-btn-confirm");
  if (btn) btn.disabled = false;
  document.getElementById("delete-modal-status").textContent = "";
  document.getElementById("delete-modal-overlay").classList.add("open");
}

function closeDeleteModal() {
  document.getElementById("delete-modal-overlay").classList.remove("open");
  _deleteFilePath = "";
}

function setDeleteMode(mode) {
  _deleteMode = mode;
  const row = document.getElementById("delete-confirm-row");
  const btn = document.getElementById("delete-btn-confirm");
  if (mode === "hard") {
    row.style.display = "";
    if (btn) btn.disabled = true;
    const input = document.getElementById("delete-confirm-input");
    if (input) input.value = "";
  } else {
    row.style.display = "none";
    if (btn) btn.disabled = false;
  }
}

function checkDeleteConfirm() {
  const input = document.getElementById("delete-confirm-input");
  const btn = document.getElementById("delete-btn-confirm");
  const name = _deleteFilePath.split("/").pop();
  if (btn) btn.disabled = input.value !== name;
}

async function doDelete() {
  const status = document.getElementById("delete-modal-status");
  const btn = document.getElementById("delete-btn-confirm");
  if (btn) btn.disabled = true;
  status.textContent = "deleting…";
  try {
    const r = await fetch("/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: _deleteFilePath, mode: _deleteMode }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      status.style.color = "#f85149";
      status.textContent = `Error: ${data.error ?? r.status}`;
      if (btn) btn.disabled = false;
      return;
    }
    closeDeleteModal();
    await loadFiles();
  } catch (e) {
    status.style.color = "#f85149";
    status.textContent = `Error: ${e.message}`;
    if (btn) btn.disabled = false;
  }
}

function renderTree(files, projectRoots = []) {
  const tree = document.getElementById("tree");
  tree.replaceChildren();
  if (files.length === 0 && projectRoots.length === 0) {
    tree.appendChild(el("div", { class: "tree-loading" }, ["No files found in allowlist."]));
    return;
  }
  const grouped = groupByType(files);
  for (const group of TYPE_GROUPS) {
    const list = grouped.get(group.type);
    if (!list || list.length === 0) continue;
    tree.appendChild(renderGroup(group, list));
  }
  const rootsSection = renderProjectRootsSection(files, projectRoots);
  if (rootsSection) tree.appendChild(rootsSection);
  markEditableFiles();
}

function selectFile(file) {
  const name = file.relPath.split("/").pop();
  openFileEditor(name, file.path);
}

async function loadFiles() {
  const tree = document.getElementById("tree");
  tree.replaceChildren(el("div", { class: "tree-loading" }, ["loading…"]));
  try {
    const r = await fetch("/files");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    renderTree(body.files, body.projectRoots ?? []);
  } catch (e) {
    tree.replaceChildren(
      el("div", { class: "tree-loading" }, [`Error loading files: ${e.message}`]),
    );
  }
}

// ── Tree expand/collapse ───────────────────────────────────────────────

function expandAll() {
  document.querySelectorAll(".dir-children").forEach((c) => c.classList.remove("collapsed"));
  document.querySelectorAll(".dir-row").forEach((r) => r.classList.remove("collapsed"));
  document.querySelectorAll(".file-content").forEach((c) => c.classList.add("open"));
  document.querySelectorAll(".file-header").forEach((h) => h.classList.add("expanded"));
}

function collapseAll() {
  document.querySelectorAll(".dir-children").forEach((c) => c.classList.add("collapsed"));
  document.querySelectorAll(".dir-row").forEach((r) => r.classList.add("collapsed"));
  document.querySelectorAll(".file-content").forEach((c) => c.classList.remove("open"));
  document.querySelectorAll(".file-header").forEach((h) => h.classList.remove("expanded"));
}

function toggle(dirRow) {
  const parent = dirRow.parentElement;
  const children = parent.querySelector(".dir-children");
  if (!children) return;
  const isCollapsed = children.classList.contains("collapsed");
  children.classList.toggle("collapsed", !isCollapsed);
  dirRow.classList.toggle("collapsed", !isCollapsed);
}

function toggleFile(header) {
  const content = header.nextElementSibling;
  if (!content) return;
  const isOpen = content.classList.contains("open");
  content.classList.toggle("open", !isOpen);
  header.classList.toggle("expanded", !isOpen);
}

// ── File editor (server up indicator + modal stub) ─────────────────────

let serverOnline = false;

async function checkServer() {
  const dot = document.getElementById("server-dot");
  const txt = document.getElementById("server-status-text");
  try {
    const r = await fetch("/files", { signal: AbortSignal.timeout(1500) });
    serverOnline = r.ok;
    dot.className = "server-dot online";
    txt.textContent = "editor server online";
    markEditableFiles();
  } catch {
    serverOnline = false;
    dot.className = "server-dot offline";
    txt.textContent = "start server: node src/server.js";
  }
}

function markEditableFiles() {
  document.querySelectorAll(".file-header[data-file-path]").forEach((header) => {
    if (header.querySelector(".file-edit-btn")) return;
    const filePath = header.dataset.filePath;
    const displayName = filePath.split("/").pop();
    const btn = document.createElement("span");
    btn.className = "file-edit-btn";
    btn.textContent = "✎";
    btn.title = "Edit " + displayName;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openFileEditor(displayName, filePath);
    });
    header.appendChild(btn);
  });
}

let _currentPath = "";
let _lastMtime = 0;
let _conflictServerMtime = 0;

function showToast(message, type = "error") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 3500);
}

function set404Actions(show) {
  document.getElementById("skill-modal-404-actions").style.display = show ? "" : "none";
  document.querySelector(".modal-btn-save").style.display = show ? "none" : "";
}

function removeFileFromList() {
  const header = document.querySelector(`.file-header[data-file-path="${CSS.escape(_currentPath)}"]`);
  if (header) {
    const treeNode = header.closest(".tree-node");
    const group = treeNode?.parentElement?.closest(".tree-node");
    treeNode?.remove();
    if (group && group.querySelectorAll(".file-node").length === 0) group.remove();
  }
  closeSkillEditor();
}

async function openFileEditor(name, filePath) {
  if (!serverOnline) {
    alert("Start the skills-manager server first:\n\nnpm start");
    return;
  }
  _currentPath = filePath;
  document.getElementById("skill-modal-name").textContent = name;
  document.getElementById("skill-modal-path").textContent = filePath;
  const status = document.getElementById("skill-modal-status");
  status.textContent = "loading…";
  status.style.color = "";
  document.getElementById("skill-modal-textarea").value = "";
  document.getElementById("skill-modal-overlay").classList.add("open");
  document.querySelector(".modal-btn-save").disabled = true;
  set404Actions(false);

  try {
    const r = await fetch(`/read?path=${encodeURIComponent(filePath)}`);
    if (r.status === 404) {
      status.style.color = "#f85149";
      status.textContent = "File not found on disk.";
      set404Actions(true);
      return;
    }
    if (r.status === 403) {
      closeSkillEditor();
      showToast("Access denied: path not in allowlist.");
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _lastMtime = data.mtime;
    document.getElementById("skill-modal-textarea").value = data.content;
    status.textContent = "";
    document.querySelector(".modal-btn-save").disabled = false;
    document.getElementById("skill-modal-textarea").focus();
  } catch (e) {
    status.style.color = "#f85149";
    status.textContent = `Error loading: ${e.message}`;
  }
}

function closeSkillEditor() {
  document.getElementById("skill-modal-overlay").classList.remove("open");
  set404Actions(false);
  _currentPath = "";
  _lastMtime = 0;
}

// ── Conflict modal ─────────────────────────────────────────────────────

function openConflictModal(myContent, theirContent, serverMtime) {
  _conflictServerMtime = serverMtime;
  document.getElementById("conflict-mine").value = myContent;
  document.getElementById("conflict-mine").readOnly = true;
  document.getElementById("conflict-theirs").value = theirContent;
  document.getElementById("conflict-footer-default").style.display = "";
  document.getElementById("conflict-footer-merge").style.display = "none";
  document.getElementById("conflict-modal-overlay").classList.add("open");
}

function closeConflictModal() {
  document.getElementById("conflict-modal-overlay").classList.remove("open");
}

async function keepMine() {
  const content = document.getElementById("conflict-mine").value;
  closeConflictModal();
  await forceSave(_currentPath, content, _conflictServerMtime);
}

function discardMine() {
  const theirContent = document.getElementById("conflict-theirs").value;
  _lastMtime = _conflictServerMtime;
  document.getElementById("skill-modal-textarea").value = theirContent;
  const status = document.getElementById("skill-modal-status");
  status.style.color = "";
  status.textContent = "";
  document.querySelector(".modal-btn-save").disabled = false;
  closeConflictModal();
}

function openBoth() {
  document.getElementById("conflict-mine").readOnly = false;
  document.getElementById("conflict-mine").focus();
  document.getElementById("conflict-footer-default").style.display = "none";
  document.getElementById("conflict-footer-merge").style.display = "";
}

async function saveMerged() {
  const content = document.getElementById("conflict-mine").value;
  closeConflictModal();
  await forceSave(_currentPath, content, _conflictServerMtime);
}

async function forceSave(filePath, content, knownMtime) {
  const status = document.getElementById("skill-modal-status");
  const saveBtn = document.querySelector(".modal-btn-save");
  status.textContent = "saving…";
  status.style.color = "";
  saveBtn.disabled = true;
  try {
    const r = await fetch("/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content, lastMtime: knownMtime }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _lastMtime = data.mtime;
    document.getElementById("skill-modal-textarea").value = content;
    status.style.color = "#3fb950";
    status.textContent = "saved ✓";
    document.querySelector(".modal-btn-save").disabled = false;
    setTimeout(() => { status.textContent = ""; status.style.color = ""; }, 2000);
  } catch (e) {
    status.style.color = "#f85149";
    status.textContent = `Error: ${e.message}`;
    saveBtn.disabled = false;
  }
}

async function saveSkill() {
  if (!_currentPath) return;
  const content = document.getElementById("skill-modal-textarea").value;
  const status = document.getElementById("skill-modal-status");
  const saveBtn = document.querySelector(".modal-btn-save");
  status.textContent = "saving…";
  status.style.color = "";
  saveBtn.disabled = true;
  try {
    const r = await fetch("/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: _currentPath, content, lastMtime: _lastMtime }),
    });
    if (r.status === 409) {
      const data = await r.json();
      saveBtn.disabled = false;
      openConflictModal(content, data.currentContent, data.currentMtime);
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _lastMtime = data.mtime;
    status.style.color = "#3fb950";
    status.textContent = "saved ✓";
    setTimeout(() => { status.textContent = ""; status.style.color = ""; }, 2000);
  } catch (e) {
    status.style.color = "#f85149";
    status.textContent = `Error: ${e.message}`;
  } finally {
    saveBtn.disabled = false;
  }
}

// ── Config panel ───────────────────────────────────────────────────────

let _cfg = { files: [], directories: [], projectRoots: [] };

function renderConfigBody() {
  const body = document.getElementById("config-modal-body");
  body.replaceChildren();

  function section(title, items, renderItem, addRow) {
    const heading = el("div", { class: "cfg-section-title" }, [title]);
    const list = el("div", { class: "cfg-list" }, items.map(renderItem));
    const add = el("div", { class: "cfg-add-row" }, addRow);
    body.appendChild(el("div", { class: "cfg-section" }, [heading, list, add]));
  }

  section("Files", _cfg.files,
    (f, i) => el("div", { class: "cfg-item" }, [
      el("span", { class: "cfg-item-text" }, [f]),
      el("button", { class: "cfg-remove-btn", onclick: () => { _cfg.files.splice(i, 1); renderConfigBody(); } }, ["✕"]),
    ]),
    [
      el("input", { class: "cfg-input", id: "cfg-file-input", placeholder: "/path/to/CLAUDE.md or ~/..." }),
      el("button", { class: "modal-btn cfg-add-btn", onclick: () => {
        const v = document.getElementById("cfg-file-input").value.trim();
        if (v) { _cfg.files.push(v); renderConfigBody(); }
      }}, ["Add"]),
    ]
  );

  section("Directories", _cfg.directories,
    (d, i) => el("div", { class: "cfg-item" }, [
      el("span", { class: "cfg-item-text" }, [`${d.path}  ${d.extensions.join(", ")}`]),
      el("button", { class: "cfg-remove-btn", onclick: () => { _cfg.directories.splice(i, 1); renderConfigBody(); } }, ["✕"]),
    ]),
    [
      el("input", { class: "cfg-input cfg-input-sm", id: "cfg-dir-path", placeholder: "path" }),
      el("input", { class: "cfg-input cfg-input-sm", id: "cfg-dir-exts", placeholder: ".md, .txt" }),
      el("button", { class: "modal-btn cfg-add-btn", onclick: () => {
        const p = document.getElementById("cfg-dir-path").value.trim();
        const exts = document.getElementById("cfg-dir-exts").value.split(",").map((s) => s.trim()).filter(Boolean);
        if (p && exts.length) { _cfg.directories.push({ path: p, extensions: exts }); renderConfigBody(); }
      }}, ["Add"]),
    ]
  );

  section("Project Roots", _cfg.projectRoots,
    (r, i) => el("div", { class: "cfg-item" }, [
      el("span", { class: "cfg-item-text" }, [r]),
      el("button", { class: "cfg-remove-btn", onclick: () => { _cfg.projectRoots.splice(i, 1); renderConfigBody(); } }, ["✕"]),
    ]),
    [
      el("input", { class: "cfg-input", id: "cfg-root-input", placeholder: "~/projects/myapp" }),
      el("button", { class: "modal-btn cfg-add-btn", onclick: () => {
        const v = document.getElementById("cfg-root-input").value.trim();
        if (v) { _cfg.projectRoots.push(v); renderConfigBody(); }
      }}, ["Add"]),
    ]
  );
}

async function openConfigPanel() {
  if (!serverOnline) {
    alert("Start the skills-manager server first:\n\nnpm start");
    return;
  }
  document.getElementById("config-modal-status").textContent = "loading…";
  document.getElementById("config-modal-status").style.color = "";
  document.getElementById("config-modal-overlay").classList.add("open");
  document.getElementById("config-modal-body").replaceChildren();
  try {
    const r = await fetch("/config");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _cfg = {
      files: [...(data.files ?? [])],
      directories: (data.directories ?? []).map((d) => ({ ...d, extensions: [...d.extensions] })),
      projectRoots: [...(data.projectRoots ?? [])],
    };
    document.getElementById("config-modal-status").textContent = "";
    renderConfigBody();
  } catch (e) {
    document.getElementById("config-modal-status").style.color = "#f85149";
    document.getElementById("config-modal-status").textContent = `Error: ${e.message}`;
  }
}

function closeConfigPanel() {
  document.getElementById("config-modal-overlay").classList.remove("open");
}

async function saveConfig() {
  const status = document.getElementById("config-modal-status");
  const saveBtn = document.querySelector(".config-btn-save");
  status.textContent = "saving…";
  status.style.color = "";
  saveBtn.disabled = true;
  try {
    const r = await fetch("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(_cfg),
    });
    const data = await r.json();
    if (!r.ok) {
      status.style.color = "#f85149";
      status.textContent = data.error ?? `Error ${r.status}`;
      return;
    }
    status.style.color = "#3fb950";
    status.textContent = "saved ✓";
    setTimeout(() => closeConfigPanel(), 800);
    loadFiles();
  } catch (e) {
    status.style.color = "#f85149";
    status.textContent = `Error: ${e.message}`;
  } finally {
    saveBtn.disabled = false;
  }
}

document.addEventListener("keydown", (e) => {
  if (document.getElementById("skill-modal-overlay").classList.contains("open")) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveSkill();
    }
    if (e.key === "Escape") closeSkillEditor();
  }
  if (e.key === "Escape" && document.getElementById("delete-modal-overlay").classList.contains("open")) {
    closeDeleteModal();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && _currentPath) {
    const name = document.getElementById("skill-modal-name").textContent;
    openFileEditor(name, _currentPath);
  }
});

// Init
checkServer();
loadFiles();
