import fs from "node:fs/promises";

export async function read(resolvedPath) {
  const [content, st] = await Promise.all([
    fs.readFile(resolvedPath, "utf8"),
    fs.stat(resolvedPath),
  ]);
  return { content, mtime: st.mtimeMs };
}
