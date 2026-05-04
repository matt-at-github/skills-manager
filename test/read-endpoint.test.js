import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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

let server;
let port;
let baseUrl;
let tmpRoot;
let allowedFile;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sm-read-"));
  allowedFile = path.join(tmpRoot, "CLAUDE.md");
  await fs.writeFile(allowedFile, "# hello\ncontent here");

  const config = {
    files: [allowedFile],
    directories: [],
    projectRoots: [],
  };
  const guard = await createGuard(config);
  port = await findFreePort();
  server = createServer({ port, config, guard });
  baseUrl = `http://localhost:${port}`;
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("GET /read returns content and mtime for allowed path", async () => {
  const real = await fs.realpath(allowedFile);
  const res = await fetch(`${baseUrl}/read?path=${encodeURIComponent(real)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.content, "# hello\ncontent here");
  assert.equal(typeof body.mtime, "number");
  assert.ok(body.mtime > 0);
});

test("GET /read returns 403 for traversal attempt", async () => {
  const traversal = `${tmpRoot}/../etc/passwd`;
  const res = await fetch(`${baseUrl}/read?path=${encodeURIComponent(traversal)}`);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.ok(body.error);
});

test("GET /read returns 404 for missing allowed file", async () => {
  const missing = path.join(tmpRoot, "CLAUDE.md");
  await fs.rm(missing, { force: true });
  const res = await fetch(`${baseUrl}/read?path=${encodeURIComponent(missing)}`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "not_found");
});
