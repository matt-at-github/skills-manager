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

function renderTree(files) {
  const tree = document.getElementById("tree");
  tree.replaceChildren();
  if (files.length === 0) {
    tree.appendChild(el("div", { class: "tree-loading" }, ["No files found in allowlist."]));
    return;
  }
  const grouped = groupByType(files);
  for (const group of TYPE_GROUPS) {
    const list = grouped.get(group.type);
    if (!list || list.length === 0) continue;
    tree.appendChild(renderGroup(group, list));
  }
  markEditableFiles();
}

function selectFile(_file) {
  // no-op — read endpoint lands in slice 5
}

async function loadFiles() {
  const tree = document.getElementById("tree");
  tree.replaceChildren(el("div", { class: "tree-loading" }, ["loading…"]));
  try {
    const r = await fetch("/files");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    renderTree(body.files);
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

async function openFileEditor(name, filePath) {
  if (!serverOnline) {
    alert("Start the skills-manager server first:\n\nnpm start");
    return;
  }
  _currentPath = filePath;
  document.getElementById("skill-modal-name").textContent = name;
  document.getElementById("skill-modal-path").textContent = filePath;
  document.getElementById("skill-modal-status").textContent = "loading…";
  document.getElementById("skill-modal-textarea").value = "";
  document.getElementById("skill-modal-overlay").classList.add("open");
  document.querySelector(".modal-btn-save").disabled = true;

  try {
    const r = await fetch(`/read?path=${encodeURIComponent(filePath)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    document.getElementById("skill-modal-textarea").value = data.content;
    document.getElementById("skill-modal-status").textContent = "";
    document.querySelector(".modal-btn-save").disabled = false;
    document.getElementById("skill-modal-textarea").focus();
  } catch (e) {
    document.getElementById("skill-modal-status").textContent = `Error loading: ${e.message}`;
  }
}

function closeSkillEditor() {
  document.getElementById("skill-modal-overlay").classList.remove("open");
  _currentPath = "";
}

async function saveSkill() {
  if (!_currentPath) return;
  const content = document.getElementById("skill-modal-textarea").value;
  const status = document.getElementById("skill-modal-status");
  const saveBtn = document.querySelector(".modal-btn-save");
  status.textContent = "saving…";
  saveBtn.disabled = true;
  try {
    const r = await fetch("/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: _currentPath, content }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    status.style.color = "#3fb950";
    status.textContent = "saved ✓";
    setTimeout(() => {
      status.textContent = "";
      status.style.color = "";
    }, 2000);
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
});

// Init
checkServer();
loadFiles();
