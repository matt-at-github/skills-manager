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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sm-delete-"));
  await fs.writeFile(path.join(tmpRoot, "CLAUDE.md"), "# test");
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

test("POST /delete with mode=hard unlinks the file", async () => {
  const filePath = path.join(tmpRoot, "CLAUDE.md");
  const res = await postJson(port, "/delete", { path: filePath, mode: "hard" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const exists = await fs.access(filePath).then(() => true).catch(() => false);
  assert.equal(exists, false);
});

test("POST /delete with mode=trash moves file to trash", async () => {
  const filePath = path.join(tmpRoot, "AGENTS.md");
  await fs.writeFile(filePath, "# agents");
  const res = await postJson(port, "/delete", { path: filePath, mode: "trash" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const exists = await fs.access(filePath).then(() => true).catch(() => false);
  assert.equal(exists, false);
});

test("POST /delete returns 403 for non-instruction filename", async () => {
  const filePath = path.join(tmpRoot, "evil.sh");
  const res = await postJson(port, "/delete", { path: filePath, mode: "hard" });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "filename_not_allowed");
});

test("POST /delete returns 403 for path outside projectRoots", async () => {
  const otherTmp = await fs.mkdtemp(path.join(os.tmpdir(), "sm-outside-"));
  try {
    const filePath = path.join(otherTmp, "CLAUDE.md");
    await fs.writeFile(filePath, "# test");
    const res = await postJson(port, "/delete", { path: filePath, mode: "hard" });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "path_not_in_projectRoot");
  } finally {
    await fs.rm(otherTmp, { recursive: true, force: true });
  }
});

test("POST /delete returns 403 for foreign Origin", async () => {
  const filePath = path.join(tmpRoot, "GEMINI.md");
  await fs.writeFile(filePath, "# gemini");
  const res = await postJson(port, "/delete", { path: filePath, mode: "hard" }, {
    Origin: "http://evil.example.com",
  });
  assert.equal(res.status, 403);
  // file should still exist since request was rejected
  const exists = await fs.access(filePath).then(() => true).catch(() => false);
  assert.ok(exists);
});
