import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export function expandHome(p) {
  if (typeof p !== "string") return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function validateConfig(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("config must be an object");
  }
  if (!Array.isArray(obj.files)) {
    throw new Error("config.files must be an array");
  }
  for (const [i, f] of obj.files.entries()) {
    if (typeof f !== "string" || f.length === 0) {
      throw new Error(`config.files[${i}] must be a non-empty string`);
    }
  }
  if (!Array.isArray(obj.directories)) {
    throw new Error("config.directories must be an array");
  }
  for (const [i, d] of obj.directories.entries()) {
    if (!d || typeof d !== "object" || Array.isArray(d)) {
      throw new Error(`config.directories[${i}] must be an object`);
    }
    if (typeof d.path !== "string" || d.path.length === 0) {
      throw new Error(`config.directories[${i}].path must be a non-empty string`);
    }
    if (!Array.isArray(d.extensions) || d.extensions.length === 0) {
      throw new Error(`config.directories[${i}].extensions must be a non-empty array`);
    }
    for (const [j, ext] of d.extensions.entries()) {
      if (typeof ext !== "string" || !ext.startsWith(".") || ext.length < 2) {
        throw new Error(
          `config.directories[${i}].extensions[${j}] must be a string starting with "." (got ${JSON.stringify(ext)})`,
        );
      }
    }
  }
  if (!Array.isArray(obj.projectRoots)) {
    throw new Error("config.projectRoots must be an array");
  }
  for (const [i, r] of obj.projectRoots.entries()) {
    if (typeof r !== "string" || r.length === 0) {
      throw new Error(`config.projectRoots[${i}] must be a non-empty string`);
    }
  }
  return obj;
}

export async function loadConfig(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config ${filePath} is not valid JSON: ${err.message}`);
  }
  return validateConfig(parsed);
}

export function getDefaultConfigPath() {
  return path.join(REPO_ROOT, "config.json");
}

export async function loadDefaultConfig() {
  const real = path.join(REPO_ROOT, "config.json");
  const example = path.join(REPO_ROOT, "config.example.json");
  try {
    await fs.access(real);
    return await loadConfig(real);
  } catch {
    return await loadConfig(example);
  }
}
