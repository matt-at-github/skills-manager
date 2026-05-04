import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createServer } from "../src/server.js";
import { createGuard } from "../src/pathGuard.js";

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function postJson(port, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: urlPath,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Host: `localhost:${port}`,
          Origin: `http://localhost:${port}`,
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let body;
          try { body = JSON.parse(text); } catch { body = text; }
          resolve({ status: res.statusCode, body });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

let server;
let port;
let tmpRoot;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sm-create-"));
  const config = {
    files: [],
    directories: [],
    projectRoots: [tmpRoot],
  };
  const guard = await createGuard(config);
  port = await findFreePort();
  server = createServer({ port, config, guard });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("POST /create creates file and returns metadata", async () => {
  const res = await postJson(port, "/create", { projectRoot: tmpRoot, filename: "CLAUDE.md" });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.path, "string");
  assert.equal(typeof res.body.relPath, "string");
  assert.equal(res.body.type, "instructionFile");
  assert.equal(typeof res.body.mtime, "number");
  const exists = await fs.access(path.join(tmpRoot, "CLAUDE.md")).then(() => true).catch(() => false);
  assert.ok(exists);
});

test("POST /create returns 409 if file already exists", async () => {
  const res = await postJson(port, "/create", { projectRoot: tmpRoot, filename: "CLAUDE.md" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "file_exists");
});

test("POST /create returns 403 for projectRoot outside config", async () => {
  const otherTmp = await fs.mkdtemp(path.join(os.tmpdir(), "sm-other-"));
  try {
    const res = await postJson(port, "/create", { projectRoot: otherTmp, filename: "AGENTS.md" });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "projectRoot_not_in_config");
  } finally {
    await fs.rm(otherTmp, { recursive: true, force: true });
  }
});

test("POST /create returns 403 for non-instruction filename", async () => {
  const res = await postJson(port, "/create", { projectRoot: tmpRoot, filename: "evil.sh" });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "filename_not_allowed");
});

test("POST /create returns 403 for foreign Origin", async () => {
  const res = await postJson(port, "/create", { projectRoot: tmpRoot, filename: "AGENTS.md" }, {
    Origin: "http://evil.example.com",
  });
  assert.equal(res.status, 403);
});
