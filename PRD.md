# PRD: skills-manager

## Problem Statement

Users running Claude Code, Claude Desktop, Gemini, and other AI coding agents accumulate a sprawling tree of instruction and configuration files across their home directory: `~/.claude/CLAUDE.md`, `~/CLAUDE.md`, `~/AGENTS.md`, `~/GEMINI.md`, project-level `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` files, custom skills under `~/.claude/skills/`, subagents under `~/.claude/agents/`, slash commands under `~/.claude/commands/`, plus MCP server config in `~/.claude.json` and `~/.claude/settings.json`.

Editing these is painful: there is no single place to see what exists, files are scattered across the filesystem, and editing them via terminal/IDE means constantly switching folders and remembering exact paths. There is also no safety net — accidental edits or deletions destroy carefully tuned agent instructions with no undo.

## Solution

A local Node web application that gives users one browser-based view of every Claude/Gemini/agent instruction file and skill on their machine, with safe inline editing, conflict detection against external edits, and bounded create/delete for the three primary instruction filenames (CLAUDE.md, AGENTS.md, GEMINI.md) within user-declared project roots.

The tool is distributed as a public GitHub repo, cloned and run locally (`npm install && npm start`). It binds only to localhost, ships a minimal but real security model (Host-header check, Origin same-origin check, exact-match allowlist), and never touches files outside the configured scope. A user-editable allowlist (`config.json`) governs which files and directories are visible, with sensible defaults covering the standard Claude/Gemini layout.

## User Stories

1. As a Claude Code user, I want to see every CLAUDE.md, AGENTS.md, and GEMINI.md on my machine in one place, so that I can review my agent instructions without hunting through directories.
2. As a Claude Code user, I want to edit my global `~/.claude/CLAUDE.md` from the browser, so that I do not need to drop to the terminal for routine instruction tweaks.
3. As a Claude Code user, I want to add new project roots to the tool, so that the project-level CLAUDE.md/AGENTS.md/GEMINI.md files in my repos appear in the tool.
4. As a Claude Code user, I want to create a new CLAUDE.md inside a registered project root, so that I can bootstrap agent instructions for a new repo without leaving the tool.
5. As a Claude Code user, I want to delete an obsolete CLAUDE.md, so that I can clean up agent instructions I no longer use.
6. As a Claude Code user, I want delete to default to OS trash, so that I can recover from a misclick.
7. As a Claude Code user, I want hard-delete to require an extra confirmation, so that I cannot destroy a file with one click.
8. As a Claude Code user, I want to browse the skills under `~/.claude/skills/`, so that I can read what each skill does without opening individual files.
9. As a Claude Code user, I want to edit a skill's `SKILL.md`, so that I can refine skill behavior in place.
10. As a Claude Code user, I want to browse the subagents under `~/.claude/agents/`, so that I can review and tune them.
11. As a Claude Code user, I want to browse the slash commands under `~/.claude/commands/`, so that I can review and tune them.
12. As a Claude Code user, I want to view and edit `~/.claude.json` and `~/.claude/settings.json`, so that I can manage MCP server config from the same tool.
13. As a Claude Code user, I want a clear hierarchy view that groups files by category (instruction files, skills, agents, commands, settings), so that I can find what I need quickly.
14. As a Claude Code user, I want a "Reload" action that re-scans the filesystem, so that files I created externally appear in the tool.
15. As a Claude Code user, I want the tool to re-fetch the current file when I focus the browser tab, so that I see fresh content after editing in another editor.
16. As a Claude Code user, I want the tool to detect when an external process modified the file I am editing, so that I do not silently overwrite someone else's changes.
17. As a Claude Code user, when an external edit conflict is detected on save, I want a diff modal showing both versions, so that I can pick which to keep or merge by hand.
18. As a Claude Code user, I want a UI panel to add/remove files and directories from the allowlist, so that I do not need to hand-edit `config.json`.
19. As a Claude Code user, I want my allowlist changes to survive `git pull`, so that I do not lose configuration when updating the tool.
20. As a Claude Code user, I want an example config (`config.example.json`) in the repo, so that I have a reference for what the schema looks like.
21. As a Claude Code user, I want a documented default port and a way to change it via `.env`, so that I can avoid collisions with other tools.
22. As a Claude Code user, I want the server to bind to localhost only, so that nobody on my network can reach it.
23. As a Claude Code user, I want the server to reject requests with a non-localhost `Host` header, so that DNS-rebinding attacks against my running server fail.
24. As a Claude Code user, I want the server to reject cross-origin write requests, so that other browser tabs on my machine cannot silently overwrite my agent instructions.
25. As a Claude Code user, I want the server to reject any path outside the configured allowlist, so that a bug in the UI cannot escape into `~/.ssh/` or other sensitive areas.
26. As a Claude Code user, I want the server to reject filenames with extensions outside the configured allowlist, so that the tool only ever opens the expected file types.
27. As a Claude Code user, when the server rejects a request, I want a clear error in the UI explaining why, so that I can correct my config or path.
28. As a Claude Code user, when I open a file that no longer exists on disk, I want the UI to offer "remove from list" or "recreate", so that I can clean up references to deleted files.
29. As a Claude Code user, I want the server to log requests with severity levels, so that I can quiet routine noise or turn on debug detail when something breaks.
30. As a Claude Code user, I want a clickable URL printed on startup, so that I can open the UI without copy-pasting.
31. As a Claude Code user, I want a README that walks me through clone-to-running in under a minute, so that I can evaluate the tool without friction.
32. As a Claude Code user, I want the README to document the security model and default allowlist, so that I understand what the tool can and cannot do.
33. As a Claude Code user, I want an AGENTS.md/CLAUDE.md in the repo itself, so that AI agents helping me work on this tool have the right context.
34. As a maintainer, I want unit tests around the path-allowlist logic, so that a refactor cannot accidentally weaken the security model.
35. As a maintainer, I want HTTP integration tests that send malicious requests (path traversal, bad `Origin`, bad `Host`, out-of-allowlist filenames), so that wiring regressions in security middleware are caught in CI.
36. As a maintainer, I want zero dev-dependencies (using `node:test`), so that contributors do not need a framework install to run tests.
37. As a contributor, I want HTML/CSS/JS split into separate files, so that PR diffs are reviewable per concern.
38. As a contributor, I want the server entry point to be a single composed file with each capability behind a deep module, so that I can reason about and test each piece in isolation.

## Implementation Decisions

**Distribution and runtime**
- Public GitHub repo, MIT license. Install model: `git clone && npm install && npm start`. Not published to npm.
- Node ≥20 LTS (stable `node:test`, modern fs APIs).
- Two runtime dependencies only: `dotenv` (load `.env`), `trash` (cross-platform OS trash). No dev dependencies.
- Built-ins handle everything else: `node:http` server, `node:fs` I/O, `node:path` resolution, `node:test` tests, `node:util.styleText` for colored logs.

**Repo layout**
- `src/` for server modules, `public/` for static assets (`index.html`, `styles.css`, `app.js`), `test/` for tests.
- v2 HTML (`claude-instructions-map-2.html`) becomes `public/index.html`. Inline `<style>` and `<script>` blocks are extracted into sibling files. v1 HTML is deleted. The visual layout from v2 is preserved verbatim.
- Repo name: `skills-manager`. Folder typo (`skils-manager`) is fixed when the repo is initialized.

**Configuration**
- `config.example.json` (tracked) and `config.json` (gitignored) follow the `.env` convention: example checked in, real config survives `git pull`.
- `config.json` schema:
  - `files: string[]` — exact paths (with `~` expansion) of singleton files (e.g. CLAUDE.md, AGENTS.md, GEMINI.md, settings.json, .claude.json).
  - `directories: { path: string, extensions: string[] }[]` — directory roots to scan for plural/user-generated content (skills, agents, commands), with the exact extensions to surface.
  - `projectRoots: string[]` — directories where the user is allowed to create/delete CLAUDE.md/AGENTS.md/GEMINI.md.
- Default allowlist covers: home-level CLAUDE.md/AGENTS.md/GEMINI.md, `~/.claude/CLAUDE.md`, `~/.claude.json`, `~/.claude/settings.json`, and the `~/.claude/{skills,agents,commands}/` directories with `.md`.
- `.env` (gitignored) carries runtime knobs separate from allowlist data: `SKILL_EDITOR_PORT` (default 7842), `SKILL_EDITOR_LOG_LEVEL` (default info). `.env.example` is tracked.

**Security model**
Three-layer defense, all enforced server-side on every request:
1. **Same-origin check** — every request must carry an `Origin` (or `Referer` fallback) matching the server's own bound host:port. Rejects drive-by writes from other browser tabs.
2. **Host-header check** — `Host` header must be `localhost:<port>` or `127.0.0.1:<port>`. Defeats DNS-rebinding attacks where an attacker domain re-resolves to 127.0.0.1.
3. **Allowlist match** — every read/write/create/delete validates the resolved (realpath, post-tilde-expansion) target against the configured `files`, `directories+extensions`, or `projectRoots+filename` rules. Exact-match semantics: no globs, no wildcards, no inferred siblings.

CORS `*` is removed. The server serves the UI from the same origin, so cross-origin access is never legitimate.

**HTTP API**
- `GET /` — serve `public/index.html`.
- `GET /<asset>` — serve static `.html` / `.css` / `.js` files from `public/` with explicit MIME whitelist.
- `GET /files` — scan allowlist, return current list of editable files with `{ path, relPath, type, mtime }`. Stateless full rescan per call (no caching, no watchers in v1).
- `GET /read?path=...` — return `{ content, mtime }`.
- `POST /write` — body `{ path, content, lastMtime }`. If on-disk mtime differs from `lastMtime`, return 409 with `{ currentMtime, currentContent }` so the UI can show a conflict-diff modal. Otherwise write and return new mtime.
- `POST /create` — body `{ projectRoot, filename }` where filename ∈ {AGENTS.md, CLAUDE.md, GEMINI.md} and projectRoot ∈ configured `projectRoots`. Creates empty file. Rejects if file already exists.
- `POST /delete` — body `{ path, mode: "trash" | "hard" }`. Trash uses the `trash` package; hard uses `fs.unlink`. Allowed only for {AGENTS, CLAUDE, GEMINI}.md within `projectRoots`.
- `GET /config` — return current `config.json`.
- `POST /config` — replace `config.json` with validated body. Triggers in-process reload.

**Backend modules**
1. `config` — load + validate `config.json` and `.env`. Typed shape out. Throws with clear message on invalid shape. Re-invoked on `POST /config`.
2. `pathGuard` (deep module) — single function `check(path, op) → { ok, resolved } | { ok: false, reason }`. Owns tilde expansion, `realpath`, allowlist matching across all three rule types, extension whitelisting, projectRoots+filename rule for create/delete. Pure given config. Heart of the security model.
3. `scanner` — given a config, walk `directories[]`, dedupe, return `{ path, type, mtime }[]`.
4. `fsOps` — read / write / create / delete (trash | hard). Each call routes through `pathGuard`. Write enforces mtime conflict semantics; create rejects if target exists; delete is filename-restricted.
5. `requestSecurity` — Host-header parser/check, Origin same-origin check. Pure (req, expected) → ok | reject reason.
6. `logger` — leveled (debug/info/warn/error), colored via `node:util.styleText`, gated by `SKILL_EDITOR_LOG_LEVEL`.
7. `server` — composes the above, wires routes, serves static assets with MIME whitelist, prints clickable startup URL.

**Frontend**
- `app.js` is the v2 inline script extracted and modularized into UI areas: file tree, editor, config panel, conflict-diff modal, delete modal, error toasts. v2's visual layout (CSS) is preserved unchanged.
- Tab-focus event triggers a re-fetch of the active file (with mtime-aware reconciliation).
- Save flow surfaces 409 conflicts via a side-by-side diff modal with three actions: keep mine (force-write with current mtime), discard mine (load remote), open both (open remote in second pane for manual merge).
- Error UX maps server status codes to inline behavior: 403 → highlight offending path in config panel; 404 → offer remove/recreate; 409 → conflict modal; 500 → error toast.
- Delete flow opens a modal offering trash (default) or hard (extra type-to-confirm step).

**Naming and ports**
- Default port 7842, fixed (no auto-fallback). Override via `SKILL_EDITOR_PORT` in `.env`. Loud failure on collision with actionable message.
- No browser auto-open. Server logs `Skill editor → http://localhost:7842` (clickable in modern terminals).

## Testing Decisions

A good test in this codebase asserts external behavior — a function's output for a given input, an HTTP endpoint's response status and body for a given request — and never the internal sequencing of helper calls or the structure of intermediate state. Tests should still pass after a refactor that preserves observable contracts.

Modules under test:

- **`pathGuard` (unit, primary)** — broadest unit suite. Covers: tilde expansion, allowlist exact-match, dir+extension match, projectRoots+filename match for create/delete, path-traversal rejection (`..`, encoded variants), symlink resolution via `realpath`, rejection of non-allowed extensions, rejection of paths outside any rule. Each rule edge gets a dedicated test.
- **`config` (unit)** — schema validation: missing fields, wrong types, empty arrays. Round-trip load → mutate → save → reload.
- **`requestSecurity` (unit)** — Host-header parse + accept/reject matrix (`localhost`, `127.0.0.1`, with/without port, attacker domain). Origin/Referer same-origin matrix.
- **HTTP integration (server boot, primary security coverage)** — full server started in test, plain `fetch` against it. Scenarios:
  - `GET /read?path=../../etc/passwd` → 403.
  - `POST /write` with allowed path but bad `Origin` → 403.
  - `POST /write` with allowed path but bad `Host` → 403.
  - `POST /write` with `lastMtime` older than disk → 409 with `currentContent`.
  - `POST /create` outside any `projectRoot` → 403.
  - `POST /create` with non-instruction filename → 403.
  - `POST /delete` for non-instruction filename → 403.
  - `POST /delete` with `mode: "trash"` succeeds and removes file from list.

Modules with tests skipped in v1: `scanner` (thin fs wrapper, exercised via integration `GET /files`), `logger` (display-only), `fsOps` (covered by integration; redoing as unit duplicates with mocks).

Test runner: built-in `node --test`, no framework. Tests live in `test/`. CI is a `node --test` invocation; no separate config needed.

Prior art: there is no prior art in this repo (greenfield). The pattern follows standard `node:test` usage in the Node ecosystem: each test file spawns a fresh fixture (temp config, temp dirs under `os.tmpdir()`), uses `before/after` hooks for setup/teardown, asserts via `node:assert/strict`.

## Out of Scope

- Publishing to npm. Distribution is git-clone only in v1.
- Auto-opening the browser on startup.
- Auto-port-fallback on collision. Failure is loud with an actionable message.
- File watchers / SSE / WebSocket push of external changes. Freshness is achieved via tab-focus refresh and mtime-guarded writes; live push is deferred.
- Folder-level partial rescan. `GET /files` is a full rescan; per-folder refresh is deferred until scale demands it.
- Rename / move operations on instruction files. v1 supports create + delete only.
- Create / delete for skills, subagents, slash commands, and MCP config files. v1 is read + write only for these.
- A templated "new skill" / "new subagent" / "new command" flow. Deferred.
- Token-based authentication. Same-origin + Host-header + allowlist are sufficient for v1; a token can be added later if the threat model changes.
- Schema validators (`zod`/`ajv`). Hand-rolled `config.json` validation with clear error messages is sufficient.
- A bundler / build step. HTML/CSS/JS are served as-is.
- UI / e2e (Playwright) tests. Unit + HTTP integration cover the security-critical surface.
- Backups beyond the OS trash. Users are expected to keep instruction files under version control where it matters.
- Multi-user or remote access. The tool is a single-user, localhost-only utility.
- Cross-platform Windows packaging. Should work via Node, but Windows is not actively tested in v1.

## Further Notes

- The folder is currently `skils-manager` (typo). Repo init renames to `skills-manager`.
- Twin Python server (`skill-editor-server.py`) is dropped. JS-only project.
- The current JS server's `Access-Control-Allow-Origin: *` is removed wholesale; same-origin is enforced.
- The current JS server hardcodes `~/claude-instructions-map-2.html` for the served HTML; the new server resolves the asset relative to the script's own directory (`__dirname`), eliminating the path drift.
- The repo will include its own `CLAUDE.md` / `AGENTS.md` (the "AI guide") so that agents working on this codebase inherit the conventions captured in this PRD.
- Default allowlist covers the standard Claude/Gemini layout out of the box; users with non-standard layouts edit `config.json` (or the UI panel) before first use.
