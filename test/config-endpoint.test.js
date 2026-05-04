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

function postConfig(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/config",
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
let baseUrl;
let tmpRoot;
let configPath;
const initialConfig = { files: [], directories: [], projectRoots: [] };

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sm-cfg-"));
  configPath = path.join(tmpRoot, "config.json");

  const guard = await createGuard(initialConfig);
  port = await findFreePort();
  server = createServer({ port, config: initialConfig, guard, configPath });
  baseUrl = `http://localhost:${port}`;
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("GET /config returns current config", async () => {
  const res = await fetch(`${baseUrl}/config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.files));
  assert.ok(Array.isArray(body.directories));
  assert.ok(Array.isArray(body.projectRoots));
});

test("POST /config with valid shape writes file and reloads in-process", async () => {
  const newConfig = {
    files: [],
    directories: [{ path: tmpRoot, extensions: [".md"] }],
    projectRoots: [],
  };
  const res = await postConfig(port, newConfig);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  const written = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.deepEqual(written, newConfig);

  const getRes = await fetch(`${baseUrl}/config`);
  const current = await getRes.json();
  assert.equal(current.directories[0].path, tmpRoot);
});

test("POST /config with invalid shape returns 400 with error message", async () => {
  const bad = { files: [123], directories: [], projectRoots: [] };
  const res = await postConfig(port, bad);
  assert.equal(res.status, 400);
  assert.ok(typeof res.body.error === "string");
  assert.ok(res.body.error.length > 0);
});

test("POST /config with foreign Origin is rejected 403", async () => {
  const res = await postConfig(port, initialConfig, {
    Origin: "http://evil.example.com",
  });
  assert.equal(res.status, 403);
});
