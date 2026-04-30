import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "../src/server.js";

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
let claudeFile;
let skillFile;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sm-files-"));
  claudeFile = path.join(tmpRoot, "CLAUDE.md");
  await fs.writeFile(claudeFile, "# claude");
  const skillsDir = path.join(tmpRoot, "skills");
  await fs.mkdir(skillsDir);
  skillFile = path.join(skillsDir, "x.md");
  await fs.writeFile(skillFile, "# skill");
  await fs.writeFile(path.join(skillsDir, "ignore.txt"), "skip");

  const config = {
    files: [claudeFile],
    directories: [{ path: skillsDir, extensions: [".md"] }],
    projectRoots: [],
  };
  port = await findFreePort();
  server = createServer({ port, config });
  baseUrl = `http://localhost:${port}`;
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("GET /files returns categorized list with expected shape", async () => {
  const res = await fetch(`${baseUrl}/files`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = await res.json();
  assert.ok(Array.isArray(body.files));
  assert.equal(body.files.length, 2);

  for (const item of body.files) {
    assert.equal(typeof item.path, "string");
    assert.equal(typeof item.relPath, "string");
    assert.equal(typeof item.type, "string");
    assert.equal(typeof item.mtime, "number");
  }

  const claudeReal = await fs.realpath(claudeFile);
  const skillReal = await fs.realpath(skillFile);
  const byPath = Object.fromEntries(body.files.map((f) => [f.path, f]));
  assert.ok(byPath[claudeReal]);
  assert.equal(byPath[claudeReal].type, "instructionFile");
  assert.ok(byPath[skillReal]);
  assert.equal(byPath[skillReal].type, "skill");
});

test("GET /files emits security headers", async () => {
  const res = await fetch(`${baseUrl}/files`);
  await res.text();
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("GET /files with attacker Host is rejected 403", async () => {
  const http = await import("node:http");
  const res = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "GET",
        path: "/files",
        headers: { Host: `evil.example.com:${port}` },
      },
      (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => resolve({ status: r.statusCode }));
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(res.status, 403);
});

test("GET /files does full rescan (picks up new files)", async () => {
  const skillsDir = path.dirname(skillFile);
  const newFile = path.join(skillsDir, "fresh.md");
  await fs.writeFile(newFile, "# fresh");
  try {
    const res = await fetch(`${baseUrl}/files`);
    const body = await res.json();
    const real = await fs.realpath(newFile);
    assert.ok(body.files.some((f) => f.path === real));
  } finally {
    await fs.rm(newFile, { force: true });
  }
});
