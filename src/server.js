import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import trash from "trash";
import { createLogger } from "./logger.js";
import { check as checkRequestSecurity } from "./requestSecurity.js";
import { loadDefaultConfig, validateConfig, getDefaultConfigPath, expandHome } from "./config.js";
import { scan } from "./scanner.js";
import { createGuard } from "./pathGuard.js";
import { read, write } from "./fsOps.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const HOME = os.homedir();
function relToHome(p) {
  if (p === HOME) return "~";
  if (p.startsWith(HOME + path.sep)) return "~/" + p.slice(HOME.length + 1);
  return p;
}
const INSTRUCTION_NAMES = new Set(["CLAUDE.md", "AGENTS.md", "GEMINI.md"]);

async function resolveProjectRoots(projectRoots) {
  return Promise.all((projectRoots ?? []).map(async (r) => {
    const exp = expandHome(r);
    return await fs.realpath(exp).catch(() => path.resolve(exp));
  }));
}

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "__pycache__", ".svn", ".hg"]);

async function walkInstructionFiles(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walkInstructionFiles(full, out);
    } else if ((e.isFile() || e.isSymbolicLink()) && INSTRUCTION_NAMES.has(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const PORT = Number(process.env.SKILL_EDITOR_PORT ?? 7842);
const LOG_LEVEL = process.env.SKILL_EDITOR_LOG_LEVEL ?? "info";
const log = createLogger(LOG_LEVEL);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

async function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const ext = path.extname(rel).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    res.writeHead(404, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    res.end("Not Found");
    return;
  }
  const target = path.resolve(PUBLIC_DIR, rel);
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    res.writeHead(403, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    res.end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(target);
    res.writeHead(200, { "Content-Type": mime, ...SECURITY_HEADERS });
    res.end(body);
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
      res.end("Not Found");
      return;
    }
    log.error("static read failed", err);
    res.writeHead(500, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    res.end("Internal Server Error");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...SECURITY_HEADERS,
  });
  res.end(JSON.stringify(body));
}

async function handleRead(req, res, guard) {
  if (!guard) {
    writeJson(res, 503, { error: "config_unavailable" });
    return;
  }
  const url = new URL(req.url, "http://x");
  const input = url.searchParams.get("path") ?? "";
  const allowed = await guard.check(input, "read");
  if (!allowed.ok) {
    writeJson(res, 403, { error: allowed.reason });
    return;
  }
  try {
    const data = await read(allowed.resolved);
    writeJson(res, 200, data);
  } catch (err) {
    if (err.code === "ENOENT") {
      writeJson(res, 404, { error: "not_found" });
      return;
    }
    log.error("read failed", err);
    writeJson(res, 500, { error: "read_failed" });
  }
}

async function handleWrite(req, res, guard) {
  if (!guard) {
    writeJson(res, 503, { error: "config_unavailable" });
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    writeJson(res, 400, { error: "bad_request" });
    return;
  }
  const { path: inputPath, content, lastMtime } = body;
  if (typeof content !== "string" || typeof lastMtime !== "number") {
    writeJson(res, 400, { error: "bad_request" });
    return;
  }
  const allowed = await guard.check(inputPath, "write");
  if (!allowed.ok) {
    writeJson(res, 403, { error: allowed.reason });
    return;
  }
  try {
    const result = await write(allowed.resolved, content, lastMtime);
    if (result.conflict) {
      writeJson(res, 409, { currentMtime: result.currentMtime, currentContent: result.currentContent });
      return;
    }
    writeJson(res, 200, { mtime: result.mtime });
  } catch (err) {
    log.error("write failed", err);
    writeJson(res, 500, { error: "write_failed" });
  }
}

async function handleFiles(req, res, config) {
  if (!config) {
    writeJson(res, 503, { error: "config_unavailable" });
    return;
  }
  try {
    const files = await scan(config);
    const seen = new Set(files.map((f) => f.path));
    const resolvedRoots = await resolveProjectRoots(config.projectRoots);
    for (const root of resolvedRoots) {
      const instrPaths = await walkInstructionFiles(root);
      for (const targetPath of instrPaths) {
        if (seen.has(targetPath)) continue;
        try {
          const st = await fs.stat(targetPath);
          files.push({
            path: targetPath,
            relPath: relToHome(targetPath),
            type: "instructionFile",
            mtime: st.mtimeMs,
          });
          seen.add(targetPath);
        } catch {
          // skip unreachable
        }
      }
    }
    writeJson(res, 200, { files, projectRoots: resolvedRoots });
  } catch (err) {
    log.error("scan failed", err);
    writeJson(res, 500, { error: "scan_failed" });
  }
}

async function handleCreate(req, res, state) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    writeJson(res, 400, { error: "bad_request" });
    return;
  }
  const { projectRoot, filename } = body;
  if (!INSTRUCTION_NAMES.has(filename)) {
    writeJson(res, 403, { error: "filename_not_allowed" });
    return;
  }
  if (!state.config) {
    writeJson(res, 503, { error: "config_unavailable" });
    return;
  }
  const resolvedRoots = await resolveProjectRoots(state.config.projectRoots);
  const expInput = expandHome(typeof projectRoot === "string" ? projectRoot : "");
  const resolvedInput = await fs.realpath(expInput).catch(() => path.resolve(expInput));
  if (!resolvedRoots.includes(resolvedInput)) {
    writeJson(res, 403, { error: "projectRoot_not_in_config" });
    return;
  }
  const targetPath = path.join(resolvedInput, filename);
  try {
    await fs.access(targetPath);
    writeJson(res, 409, { error: "file_exists" });
    return;
  } catch {
    // file doesn't exist, proceed
  }
  try {
    await fs.writeFile(targetPath, "", "utf8");
    const st = await fs.stat(targetPath);
    writeJson(res, 200, {
      path: targetPath,
      relPath: relToHome(targetPath),
      type: "instructionFile",
      mtime: st.mtimeMs,
    });
  } catch (err) {
    log.error("create failed", err);
    writeJson(res, 500, { error: "create_failed" });
  }
}

async function handleDelete(req, res, state) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    writeJson(res, 400, { error: "bad_request" });
    return;
  }
  const { path: inputPath, mode } = body;
  if (mode !== "trash" && mode !== "hard") {
    writeJson(res, 400, { error: "invalid_mode" });
    return;
  }
  const basename = path.basename(typeof inputPath === "string" ? inputPath : "");
  if (!INSTRUCTION_NAMES.has(basename)) {
    writeJson(res, 403, { error: "filename_not_allowed" });
    return;
  }
  if (!state.config) {
    writeJson(res, 503, { error: "config_unavailable" });
    return;
  }
  const resolvedRoots = await resolveProjectRoots(state.config.projectRoots);
  const resolvedInput = await fs.realpath(typeof inputPath === "string" ? inputPath : "").catch(() => path.resolve(typeof inputPath === "string" ? inputPath : ""));
  const inRoot = resolvedRoots.some((r) => resolvedInput === r || resolvedInput.startsWith(r + path.sep));
  if (!inRoot) {
    writeJson(res, 403, { error: "path_not_in_projectRoot" });
    return;
  }
  try {
    if (mode === "trash") {
      await trash(resolvedInput);
    } else {
      await fs.unlink(resolvedInput);
    }
    writeJson(res, 200, { ok: true });
  } catch (err) {
    log.error("delete failed", err);
    writeJson(res, 500, { error: "delete_failed" });
  }
}

function handleGetConfig(req, res, config) {
  if (!config) {
    writeJson(res, 503, { error: "config_unavailable" });
    return;
  }
  writeJson(res, 200, config);
}

async function handlePostConfig(req, res, state, configPath) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    writeJson(res, 400, { error: "bad_request" });
    return;
  }
  try {
    validateConfig(body);
  } catch (err) {
    writeJson(res, 400, { error: err.message });
    return;
  }
  const target = configPath ?? getDefaultConfigPath();
  try {
    await fs.writeFile(target, JSON.stringify(body, null, 2) + "\n", "utf8");
  } catch (err) {
    log.error("config write failed", err);
    writeJson(res, 500, { error: "write_failed" });
    return;
  }
  state.guard = await createGuard(body);
  state.config = body;
  writeJson(res, 200, { ok: true });
}

export function createServer({ port = PORT, config = null, guard = null, configPath = null } = {}) {
  const state = { config, guard };
  const expectedOrigin = `http://localhost:${port}`;
  return http.createServer((req, res) => {
    log.debug(req.method, req.url);
    const sec = checkRequestSecurity(req, expectedOrigin);
    if (!sec.ok) {
      log.warn("rejected request", req.method, req.url, sec.reason);
      res.writeHead(403, {
        "Content-Type": "text/plain",
        ...SECURITY_HEADERS,
      });
      res.end(`Forbidden: ${sec.reason}`);
      return;
    }
    const urlPath = (req.url ?? "/").split("?")[0];
    if (req.method === "POST" && urlPath === "/config") {
      handlePostConfig(req, res, state, configPath);
      return;
    }
    if (req.method === "GET" && urlPath === "/config") {
      handleGetConfig(req, res, state.config);
      return;
    }
    if (req.method === "POST" && urlPath === "/create") {
      handleCreate(req, res, state);
      return;
    }
    if (req.method === "POST" && urlPath === "/delete") {
      handleDelete(req, res, state);
      return;
    }
    if (req.method === "POST" && urlPath === "/write") {
      handleWrite(req, res, state.guard);
      return;
    }
    if (req.method === "GET" && urlPath === "/read") {
      handleRead(req, res, state.guard);
      return;
    }
    if (req.method === "GET" && urlPath === "/files") {
      handleFiles(req, res, state.config);
      return;
    }
    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }
    res.writeHead(405, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    res.end("Method Not Allowed");
  });
}

export async function start({ port = PORT } = {}) {
  let config = null;
  try {
    config = await loadDefaultConfig();
  } catch (err) {
    log.error("failed to load config", err);
    process.exit(1);
  }
  const configPath = getDefaultConfigPath();
  const guard = await createGuard(config);
  const server = createServer({ port, config, guard, configPath });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      log.error(
        `Port ${port} is already in use. Set SKILL_EDITOR_PORT in .env to a free port and retry.`,
      );
      process.exit(1);
    }
    log.error("server error", err);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    log.info(`Skill editor → http://localhost:${port}`);
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) start();
