import { Parser } from "tar";
import type { ScanFile } from "./types.ts";

/**
 * Un-tar an already-gunzipped tarball buffer into in-memory ScanFiles.
 * Strips the single top-level directory GitHub prepends ("owner-repo-sha/"),
 * so paths come out repo-relative. Parsing is synchronous: tar's Parser emits
 * entries as the buffer is written.
 */
export function untarToFiles(buffer: Buffer): ScanFile[] {
  const files: ScanFile[] = [];
  const parser = new Parser({
    onReadEntry(entry) {
      if (entry.type !== "File") {
        entry.resume();
        return;
      }
      const chunks: Buffer[] = [];
      entry.on("data", (c: Buffer) => chunks.push(c));
      entry.on("end", () => {
        const path = entry.path.split("/").slice(1).join("/");
        if (path !== "") files.push({ path, text: Buffer.concat(chunks).toString("utf8") });
      });
    },
  });
  parser.end(buffer);
  return files;
}
