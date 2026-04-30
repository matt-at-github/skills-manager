# skills-manager

A local web app for browsing and editing the AI-agent instruction files scattered across your home directory — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, skills, subagents, slash commands, MCP config — from a single browser UI.

> **Status:** v1 in development. See the [PRD](https://github.com/matt-at-github/skills-manager/issues/1) and the [v1 issues](https://github.com/matt-at-github/skills-manager/issues) for current progress.

## Why

Claude Code, Claude Desktop, Gemini, and other AI coding agents accumulate a sprawling tree of instruction and configuration files: `~/.claude/CLAUDE.md`, `~/CLAUDE.md`, `~/AGENTS.md`, `~/GEMINI.md`, project-level instruction files, skills under `~/.claude/skills/`, subagents under `~/.claude/agents/`, slash commands under `~/.claude/commands/`, MCP config in `~/.claude.json` and `~/.claude/settings.json`.

Editing these means hunting through directories and remembering exact paths. There is no safety net — accidental edits or deletions destroy carefully tuned agent instructions with no undo.

`skills-manager` puts every one of those files in a single browser view with safe inline editing, conflict detection against external edits, and bounded create/delete for `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` within user-declared project roots.

## Requirements

- Node 20 LTS or newer
- Linux, macOS, or Windows (Node-supported)

## Quickstart

```bash
git clone https://github.com/matt-at-github/skills-manager.git
cd skills-manager
npm install
cp config.example.json config.json
cp .env.example .env
npm start
```

The server prints a clickable URL on startup:

```
Skill editor → http://localhost:7842
```

Open it in your browser.

## Configuration

Two configuration surfaces, both following the `.env` convention (example tracked in git, real config gitignored):

### `config.json` — what the UI can see and edit

```json
{
  "files": [
    "~/.claude/CLAUDE.md",
    "~/CLAUDE.md",
    "~/AGENTS.md",
    "~/GEMINI.md",
    "~/.claude.json",
    "~/.claude/settings.json"
  ],
  "directories": [
    { "path": "~/.claude/skills",   "extensions": [".md"] },
    { "path": "~/.claude/agents",   "extensions": [".md"] },
    { "path": "~/.claude/commands", "extensions": [".md"] }
  ],
  "projectRoots": []
}
```

- **`files[]`** — exact paths of singleton files (instruction files, settings).
- **`directories[]`** — directory roots scanned for plural/user-generated content (skills, agents, commands), with the exact extensions to surface.
- **`projectRoots[]`** — directories where you can create or delete `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` from the UI. Empty by default — add your project roots here (or via the in-UI config panel).

Edits to `config.json` can be made via the in-UI config panel (changes survive `git pull` because `config.json` is gitignored).

### `.env` — runtime knobs

```
SKILL_EDITOR_PORT=7842
SKILL_EDITOR_LOG_LEVEL=info
```

- **`SKILL_EDITOR_PORT`** — default `7842`. Override if the port collides.
- **`SKILL_EDITOR_LOG_LEVEL`** — `debug` / `info` / `warn` / `error`. Default `info`.

## Security model

The server binds to localhost only and enforces three layers of defense on every request:

1. **Same-origin check** — the `Origin` (or `Referer` fallback) header must match the server's bound host:port. Blocks any other browser tab on your machine from silently writing to your agent config.
2. **Host-header check** — the `Host` header must be `localhost:<port>` or `127.0.0.1:<port>`. Defeats DNS-rebinding attacks where an attacker domain re-resolves to 127.0.0.1.
3. **Path allowlist** — every read / write / create / delete validates the resolved path (post-tilde-expansion, post-`realpath`) against the configured `files`, `directories+extensions`, or `projectRoots+filename` rules. Exact-match semantics, no globs, no wildcards.

CRUD scope is intentionally narrow:
- **Read + Write** — every file in the allowlist.
- **Create + Delete** — only `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` within `projectRoots`.
- Delete defaults to OS trash (recoverable). Hard delete requires type-to-confirm.
- No rename / move in v1.

External edits are detected on save via mtime comparison: stale saves get a 409 with a side-by-side diff modal so you can reconcile by hand.

## Development

```bash
npm test    # node:test, no framework
npm start
```

Tests live in `test/`. Two layers:

- **Unit** — `pathGuard` allowlist + traversal rejection, `config` schema validation, `requestSecurity` Host/Origin matrix.
- **HTTP integration** — full server boot, attack matrix (path traversal, foreign Origin, bad Host, mtime conflicts, delete safety).

Zero dev dependencies — runs on `node --test` directly.

## Contributing

The PRD ([issue #1](https://github.com/matt-at-github/skills-manager/issues/1)) captures the locked architectural decisions for v1. v1 is broken into vertical-slice issues — see [the issue tracker](https://github.com/matt-at-github/skills-manager/issues) for what is grabbable.

A few non-negotiables:

- Single source of truth for configurable security: every read/write/create/delete routes through the `pathGuard` deep module.
- No `Access-Control-Allow-Origin: *`. Same-origin only.
- No build step, no bundler. HTML/CSS/JS served as-is from `public/`.
- Two runtime dependencies (`dotenv`, `trash`). Zero dev dependencies (use `node:test`).
- Every new endpoint gets an HTTP integration test for at least one rejection path.

## License

[MIT](LICENSE)
