import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { validateConfig, loadConfig, expandHome } from "../src/config.js";

test("validateConfig accepts a minimal valid shape", () => {
  const cfg = { files: [], directories: [], projectRoots: [] };
  assert.deepEqual(validateConfig(cfg), cfg);
});

test("validateConfig accepts a fully populated shape", () => {
  const cfg = {
    files: ["~/CLAUDE.md", "/abs/path.md"],
    directories: [{ path: "~/.claude/skills", extensions: [".md"] }],
    projectRoots: ["~/code/proj"],
  };
  assert.deepEqual(validateConfig(cfg), cfg);
});

test("validateConfig rejects non-object", () => {
  assert.throws(() => validateConfig(null), /must be an object/);
  assert.throws(() => validateConfig([]), /must be an object/);
  assert.throws(() => validateConfig("x"), /must be an object/);
});

test("validateConfig rejects missing arrays", () => {
  assert.throws(() => validateConfig({ directories: [], projectRoots: [] }), /files/);
  assert.throws(() => validateConfig({ files: [], projectRoots: [] }), /directories/);
  assert.throws(() => validateConfig({ files: [], directories: [] }), /projectRoots/);
});

test("validateConfig rejects empty file string", () => {
  assert.throws(
    () => validateConfig({ files: [""], directories: [], projectRoots: [] }),
    /files\[0\]/,
  );
});

test("validateConfig rejects bad directory entries", () => {
  assert.throws(
    () =>
      validateConfig({
        files: [],
        directories: [{ path: "", extensions: [".md"] }],
        projectRoots: [],
      }),
    /directories\[0\]\.path/,
  );
  assert.throws(
    () =>
      validateConfig({
        files: [],
        directories: [{ path: "x", extensions: [] }],
        projectRoots: [],
      }),
    /extensions/,
  );
  assert.throws(
    () =>
      validateConfig({
        files: [],
        directories: [{ path: "x", extensions: ["md"] }],
        projectRoots: [],
      }),
    /must be a string starting with "\."/,
  );
});

test("loadConfig round-trips a written config", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sm-config-"));
  try {
    const f = path.join(dir, "config.json");
    const cfg = {
      files: ["~/x"],
      directories: [{ path: "~/d", extensions: [".md"] }],
      projectRoots: [],
    };
    await fs.writeFile(f, JSON.stringify(cfg));
    const loaded = await loadConfig(f);
    assert.deepEqual(loaded, cfg);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig rejects malformed JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sm-config-"));
  try {
    const f = path.join(dir, "config.json");
    await fs.writeFile(f, "{not json");
    await assert.rejects(() => loadConfig(f), /not valid JSON/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("expandHome handles ~, ~/, and absolute", () => {
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(expandHome("~/x"), path.join(os.homedir(), "x"));
  assert.equal(expandHome("/abs/x"), "/abs/x");
});
