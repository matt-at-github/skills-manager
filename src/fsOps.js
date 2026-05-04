import fs from "node:fs/promises";

export async function read(resolvedPath) {
  const [content, st] = await Promise.all([
    fs.readFile(resolvedPath, "utf8"),
    fs.stat(resolvedPath),
  ]);
  return { content, mtime: st.mtimeMs };
}

export async function write(resolvedPath, content, lastMtime) {
  let currentMtime = null;
  try {
    const st = await fs.stat(resolvedPath);
    currentMtime = st.mtimeMs;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  if (currentMtime !== null && currentMtime !== lastMtime) {
    const currentContent = await fs.readFile(resolvedPath, "utf8");
    return { conflict: true, currentMtime, currentContent };
  }

  await fs.writeFile(resolvedPath, content, "utf8");
  const newSt = await fs.stat(resolvedPath);
  return { conflict: false, mtime: newSt.mtimeMs };
}
