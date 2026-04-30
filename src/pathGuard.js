import fs from "node:fs/promises";
import path from "node:path";
import { expandHome } from "./config.js";

async function tryRealpath(p) {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

function hasTraversalSegment(p) {
  return p.split(/[/\\]/).some((seg) => seg === "..");
}

export async function createGuard(config) {
  const fileRealSet = new Set();
  for (const f of config.files) {
    const expanded = expandHome(f);
    const real = (await tryRealpath(expanded)) ?? path.resolve(expanded);
    fileRealSet.add(real);
  }
  const dirs = [];
  for (const d of config.directories) {
    const expanded = expandHome(d.path);
    const real = (await tryRealpath(expanded)) ?? path.resolve(expanded);
    dirs.push({ real, extensions: new Set(d.extensions.map((e) => e.toLowerCase())) });
  }

  async function check(input, _op) {
    if (typeof input !== "string" || input.length === 0) {
      return { ok: false, reason: "bad_path" };
    }
    if (hasTraversalSegment(input)) {
      return { ok: false, reason: "traversal_segment" };
    }
    const expanded = expandHome(input);
    const resolved = path.resolve(expanded);
    if (hasTraversalSegment(resolved)) {
      return { ok: false, reason: "traversal_segment" };
    }
    const real = (await tryRealpath(resolved)) ?? resolved;

    if (fileRealSet.has(real)) {
      return { ok: true, resolved: real };
    }
    const ext = path.extname(real).toLowerCase();
    for (const d of dirs) {
      const inside = real === d.real || real.startsWith(d.real + path.sep);
      if (!inside) continue;
      if (real === d.real) continue; // directory itself, not a file
      if (!d.extensions.has(ext)) {
        return { ok: false, reason: "extension_not_allowed" };
      }
      return { ok: true, resolved: real };
    }
    return { ok: false, reason: "not_in_allowlist" };
  }

  return { check, fileRealSet, dirs };
}
