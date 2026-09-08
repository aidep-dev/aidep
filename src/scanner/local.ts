import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { safePath } from "./scan.ts";
import type { ScanFile } from "./types.ts";

// scan.ts re-checks vendor/dist/etc.; skipping these two here just avoids
// reading thousands of files we know we'll throw away.
const WALK_SKIP = new Set([".git", "node_modules"]);

export async function loadLocalDir(root: string): Promise<ScanFile[]> {
  const files: ScanFile[] = [];

  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!WALK_SKIP.has(entry.name)) await walk(join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        const path = safePath(relPath);
        if (path !== null) files.push({ path, text: await readFile(join(dir, entry.name), "utf8") });
      }
    }
  }

  await walk(root, "");
  return files;
}
