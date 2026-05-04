import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createGuard } from "../src/pathGuard.js";

async function tmpDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sm-pg-"));
}

test("allows exact-match file", async () => {
  const root = await tmpDir();
  try {
    const f = path.join(root, "CLAUDE.md");
    await fs.writeFile(f, "x");
    const g = await createGuard({
      files: [f],
      directories: [],
      projectRoots: [],
    });
    const r = await g.check(f);
    assert.equal(r.ok, true);
    assert.equal(r.resolved, await fs.realpath(f));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects file not in allowlist", async () => {
  const root = await tmpDir();
  try {
    const a = path.join(root, "ok.md");
    const b = path.join(root, "secret.md");
    await fs.writeFile(a, "");
    await fs.writeFile(b, "");
    const g = await createGuard({ files: [a], directories: [], projectRoots: [] });
    const r = await g.check(b);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_in_allowlist");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("allows file inside allowlisted directory with matching extension", async () => {
  const root = await tmpDir();
  try {
    const dir = path.join(root, "skills");
    await fs.mkdir(dir);
    const f = path.join(dir, "x.md");
    await fs.writeFile(f, "");
    const g = await createGuard({
      files: [],
      directories: [{ path: dir, extensions: [".md"] }],
      projectRoots: [],
    });
    const r = await g.check(f);
    assert.equal(r.ok, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects extension not in directory whitelist", async () => {
  const root = await tmpDir();
  try {
    const dir = path.join(root, "skills");
    await fs.mkdir(dir);
    const f = path.join(dir, "x.txt");
    await fs.writeFile(f, "");
    const g = await createGuard({
      files: [],
      directories: [{ path: dir, extensions: [".md"] }],
      projectRoots: [],
    });
    const r = await g.check(f);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "extension_not_allowed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal with .. in input", async () => {
  const root = await tmpDir();
  try {
    const dir = path.join(root, "skills");
    await fs.mkdir(dir);
    const inside = path.join(dir, "x.md");
    await fs.writeFile(inside, "");
    const g = await createGuard({
      files: [],
      directories: [{ path: dir, extensions: [".md"] }],
      projectRoots: [],
    });
    const evil = dir + "/../../etc/passwd";
    const r = await g.check(evil);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "traversal_segment");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects symlink that escapes allowlisted directory", async () => {
  const root = await tmpDir();
  try {
    const dir = path.join(root, "skills");
    const outside = path.join(root, "secrets");
    await fs.mkdir(dir);
    await fs.mkdir(outside);
    const target = path.join(outside, "leak.md");
    await fs.writeFile(target, "secret");
    const link = path.join(dir, "link.md");
    await fs.symlink(target, link);
    const g = await createGuard({
      files: [],
      directories: [{ path: dir, extensions: [".md"] }],
      projectRoots: [],
    });
    const r = await g.check(link);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_in_allowlist");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("follows symlink that points inside allowlisted directory", async () => {
  const root = await tmpDir();
  try {
    const dir = path.join(root, "skills");
    await fs.mkdir(dir);
    const target = path.join(dir, "real.md");
    await fs.writeFile(target, "");
    const link = path.join(root, "alias.md");
    await fs.symlink(target, link);
    const g = await createGuard({
      files: [],
      directories: [{ path: dir, extensions: [".md"] }],
      projectRoots: [],
    });
    const r = await g.check(link);
    assert.equal(r.ok, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("expands tilde in input path against tilde-configured allowlist", async () => {
  const sentinel = ".sm-pg-tilde-test-" + process.pid;
  const target = path.join(os.homedir(), sentinel);
  await fs.writeFile(target, "");
  try {
    const g = await createGuard({
      files: ["~/" + sentinel],
      directories: [],
      projectRoots: [],
    });
    const r = await g.check("~/" + sentinel);
    assert.equal(r.ok, true);
  } finally {
    await fs.rm(target, { force: true });
  }
});

test("rejects empty / non-string input", async () => {
  const g = await createGuard({ files: [], directories: [], projectRoots: [] });
  assert.equal((await g.check("")).ok, false);
  assert.equal((await g.check(null)).ok, false);
  assert.equal((await g.check(undefined)).ok, false);
});

test("rejects directory itself (not a file)", async () => {
  const root = await tmpDir();
  try {
    const dir = path.join(root, "skills");
    await fs.mkdir(dir);
    const g = await createGuard({
      files: [],
      directories: [{ path: dir, extensions: [".md"] }],
      projectRoots: [],
    });
    const r = await g.check(dir);
    assert.equal(r.ok, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
