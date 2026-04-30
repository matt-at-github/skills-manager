import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { createLogger } from "./logger.js";
import { check as checkRequestSecurity } from "./requestSecurity.js";

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

async function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const ext = path.extname(rel).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }
  const target = path.resolve(PUBLIC_DIR, rel);
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(target);
    res.writeHead(200, { "Content-Type": mime });
    res.end(body);
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    log.error("static read failed", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
}

export function createServer({ port = PORT } = {}) {
  const expectedOrigin = `http://localhost:${port}`;
  return http.createServer((req, res) => {
    log.debug(req.method, req.url);
    const sec = checkRequestSecurity(req, expectedOrigin);
    if (!sec.ok) {
      log.warn("rejected request", req.method, req.url, sec.reason);
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end(`Forbidden: ${sec.reason}`);
      return;
    }
    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
  });
}

export function start({ port = PORT } = {}) {
  const server = createServer({ port });
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
