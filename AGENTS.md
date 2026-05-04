# AGENTS.md — skills-manager

Architecture guide for agents working on this codebase.

## What this is

A local-only Node.js HTTP server + vanilla-JS browser UI for browsing, editing, creating, and deleting AI-agent instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, skills, agents, commands, settings). No build step. No framework. Runs directly with `node src/server.js`.

## Architecture decisions

- **No build step.** `public/` is served as-is: HTML, CSS, and plain JS (no transpilation, no bundler, no TypeScript). Static file handler is in `serveStatic`.
- **Deep modules.** Complex logic is in focused modules. `server.js` is thin: it validates the request, delegates to a handler, and calls `writeJson`. Business logic lives in dedicated files.
- **Security-first.** Every mutating operation validates three things in order: (1) request legitimacy (Origin + Host), (2) path is in allowlist, (3) file-level constraint. Skipping any step is a defect.
- **Two runtime deps.** `dotenv` (env loading) and `trash` (safe delete to OS trash). Zero dev dependencies — `node --test` runs the test suite directly.
- **Atomic writes.** All writes go through `fsOps.write`, which does an mtime-compare-then-write. Callers pass `lastMtime`; if the on-disk mtime has advanced, the response is 409 with current content so the UI can show a diff.

## Module responsibilities

| Module | Purpose |
|---|---|
| `src/server.js` | HTTP routing, request parsing, response writing, and handler dispatch. Exports `createServer` (testable, takes injected config/guard) and `start` (production boot). |
| `src/pathGuard.js` | Path allowlist — validates that a requested path resolves to something in `config.files`, `config.directories`, or (for instruction files) `config.projectRoots`. Returns `{ ok, resolved, reason }`. |
| `src/requestSecurity.js` | CSRF-style same-origin + Host-header check. Called first on every request. Returns `{ ok, reason }`. |
| `src/config.js` | JSON schema validation (`validateConfig`), tilde expansion (`expandHome`), and default config loading. |
| `src/scanner.js` | Filesystem walk — expands `config.files` and `config.directories` into a flat array of `{ path, relPath, type, mtime }`. |
| `src/fsOps.js` | Atomic read (`read`) and write (`write`) with mtime conflict detection. |
| `src/logger.js` | Minimal leveled logger (`debug`/`info`/`warn`/`error`). No external deps. |

## Adding a new endpoint safely

1. Add a handler function `async function handleFoo(req, res, state)`.
2. Parse and validate the request body early; return 400 on bad shape.
3. Validate authorization (path guard, projectRoot check, or filename allowlist) before touching the filesystem.
4. Use `writeJson(res, status, body)` for all JSON responses — never `res.end(JSON.stringify(...))` directly.
5. Register the route in `createServer` before the static fallback, after the security check.
6. Write an integration test in `test/foo-endpoint.test.js` that covers: success, 403 for foreign Origin, and the primary rejection path.

## Test conventions

- Framework: `node:test` with `node:assert/strict`. No test framework.
- All tests are integration tests: they boot a real HTTP server on a random port (`findFreePort`), write real files to a `os.tmpdir()` subdirectory, and tear down via `after`.
- Raw `http.request` (not `fetch`) for tests that need to control headers like `Origin` or `Host`.
- No mocks. No stubs. File operations run on the real filesystem.
- `before` creates the tmpdir and server. `after` closes the server and `rm -rf`s the tmpdir.
- Tests clean up their own state (create only what they test; delete only what they created).

## Instruction file scope

Create and delete are gated to `INSTRUCTION_NAMES = { CLAUDE.md, AGENTS.md, GEMINI.md }` within paths that are under a configured `projectRoot`. This set is a constant in `server.js` and must not be widened without a security review.

- `POST /create` — creates an empty instruction file in a project root. Returns `{ path, relPath, type, mtime }`.
- `POST /delete` — deletes an instruction file. `mode: "trash"` (default, recoverable via OS trash) or `mode: "hard"` (permanent, requires type-to-confirm in UI).

## GET /files response shape

```json
{
  "files": [
    { "path": "/abs/path", "relPath": "~/rel/path", "type": "instructionFile|skill|agent|command|settings|other", "mtime": 1234567890 }
  ],
  "projectRoots": ["/resolved/path/to/root"]
}
```

`projectRoots` are resolved (tilde-expanded + realpath). The UI uses them to render per-root instruction file panels with create/delete affordances.

## Security invariants

- `resolveProjectRoots` always resolves symlinks. A symlink pointing outside the intended root cannot bypass the check.
- `startsWith(root + path.sep)` (not just `startsWith(root)`) prevents a root `/foo` from matching `/foobar`.
- Instruction file basenames are validated with an exact-Set lookup, not a suffix check, so `evil-CLAUDE.md` is rejected.
- The CSRF check (`checkRequestSecurity`) runs before any handler. Handlers must never run before it.

## .env knobs

| Variable | Default | Effect |
|---|---|---|
| `SKILL_EDITOR_PORT` | `7842` | TCP port the server binds to (localhost only). |
| `SKILL_EDITOR_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error`. |

## Running tests

```bash
npm test
```

Runs `node --test test/*.test.js`. No watcher, no coverage, no build needed.
