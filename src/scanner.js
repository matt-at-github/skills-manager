import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expandHome } from "./config.js";

const INSTRUCTION_FILES = new Set(["CLAUDE.md", "AGENTS.md", "GEMINI.md"]);
const SETTINGS_FILES = new Set(["settings.json", ".claude.json"]);

function classifyFile(filePath, dirRoot) {
  const base = path.basename(filePath);
  if (INSTRUCTION_FILES.has(base)) return "instructionFile";
  if (SETTINGS_FILES.has(base)) return "settings";
  if (dirRoot) {
    const rootBase = path.basename(dirRoot);
    if (rootBase === "skills") return "skill";
    if (rootBase === "agents") return "agent";
    if (rootBase === "commands") return "command";
  }
  return "other";
}

function relToHome(p) {
  const home = os.homedir();
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~/" + p.slice(home.length + 1);
  return p;
}

async function statOrNull(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function realpathOrNull(p) {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

async function walk(dir, exts, out, dirRoot) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, exts, out, dirRoot);
    } else if (e.isFile() || e.isSymbolicLink()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!exts.has(ext)) continue;
      const real = (await realpathOrNull(full)) ?? full;
      const st = await statOrNull(real);
      if (!st || !st.isFile()) continue;
      out.push({
        path: real,
        relPath: relToHome(real),
        type: classifyFile(real, dirRoot),
        mtime: st.mtimeMs,
      });
    }
  }
}

export async function scan(config) {
  const out = [];
  const seen = new Set();

  for (const f of config.files) {
    const expanded = expandHome(f);
    const real = (await realpathOrNull(expanded)) ?? expanded;
    const st = await statOrNull(real);
    if (!st || !st.isFile()) continue;
    if (seen.has(real)) continue;
    seen.add(real);
    out.push({
      path: real,
      relPath: relToHome(real),
      type: classifyFile(real, null),
      mtime: st.mtimeMs,
    });
  }

  for (const d of config.directories) {
    const expanded = expandHome(d.path);
    const real = (await realpathOrNull(expanded)) ?? expanded;
    const exts = new Set(d.extensions.map((e) => e.toLowerCase()));
    const collected = [];
    await walk(real, exts, collected, real);
    for (const item of collected) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      out.push(item);
    }
  }

  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}
