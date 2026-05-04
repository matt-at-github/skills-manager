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

function postWrite(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/write",
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
let allowedFile;
let fileMtime;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sm-write-"));
  allowedFile = path.join(tmpRoot, "CLAUDE.md");
  await fs.writeFile(allowedFile, "original content");
  const st = await fs.stat(allowedFile);
  fileMtime = st.mtimeMs;

  const config = {
    files: [allowedFile],
    directories: [],
    projectRoots: [],
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

test("POST /write saves content and returns new mtime", async () => {
  const real = await fs.realpath(allowedFile);
  const res = await postWrite(port, { path: real, content: "updated content", lastMtime: fileMtime });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.mtime, "number");
  assert.ok(res.body.mtime > 0);
  const written = await fs.readFile(allowedFile, "utf8");
  assert.equal(written, "updated content");
  fileMtime = res.body.mtime;
});

test("POST /write returns 409 on mtime mismatch with currentContent", async () => {
  const real = await fs.realpath(allowedFile);
  const staleTime = fileMtime - 1000;
  const res = await postWrite(port, { path: real, content: "my new edit", lastMtime: staleTime });
  assert.equal(res.status, 409);
  assert.equal(typeof res.body.currentMtime, "number");
  assert.equal(typeof res.body.currentContent, "string");
  assert.equal(res.body.currentContent, "updated content");
});

test("POST /write returns 403 for traversal attempt", async () => {
  const traversal = `${tmpRoot}/../etc/passwd`;
  const res = await postWrite(port, { path: traversal, content: "evil", lastMtime: 0 });
  assert.equal(res.status, 403);
});

test("POST /write returns 403 for foreign Origin", async () => {
  const real = await fs.realpath(allowedFile);
  const res = await postWrite(port, { path: real, content: "evil", lastMtime: fileMtime }, {
    Origin: "http://evil.example.com",
  });
  assert.equal(res.status, 403);
});
