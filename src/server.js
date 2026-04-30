import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { createLogger } from "./logger.js";
import { check as checkRequestSecurity } from "./requestSecurity.js";
import { loadDefaultConfig } from "./config.js";
import { scan } from "./scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

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

function writeJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...SECURITY_HEADERS,
  });
  res.end(JSON.stringify(body));
}

async function handleFiles(req, res, config) {
  if (!config) {
    writeJson(res, 503, { error: "config_unavailable" });
    return;
  }
  try {
    const files = await scan(config);
    writeJson(res, 200, { files });
  } catch (err) {
    log.error("scan failed", err);
    writeJson(res, 500, { error: "scan_failed" });
  }
}

export function createServer({ port = PORT, config = null } = {}) {
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
    if (req.method === "GET" && urlPath === "/files") {
      handleFiles(req, res, config);
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
  const server = createServer({ port, config });
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
