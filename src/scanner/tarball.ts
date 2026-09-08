import { Parser } from "tar";
import { MAX_BYTES, safePath } from "./scan.ts";
import type { ScanFile } from "./types.ts";

/**
 * Pass as gunzipSync's maxOutputLength: git stores a 99 MB file of zeros as a
 * few KB, so a small tarball can expand to gigabytes and a bomb must throw
 * instead of exhausting memory.
 */
export const MAX_TARBALL_BYTES = 256 * 1024 * 1024;

/** Entries past this count are dropped unread. */
export const MAX_FILES = 5000;

/** What the ingest dropped, so the report can say the scan was partial. */
export interface UntarStats {
  /** file entries over the scan size cap, never buffered */
  skippedLarge: number;
  /** the archive had more than MAX_FILES entries and the rest went unread */
  truncated: boolean;
}

/**
 * Un-tar an already-gunzipped tarball buffer into in-memory ScanFiles.
 * Strips the single top-level directory GitHub prepends ("owner-repo-sha/"),
 * so paths come out repo-relative. Parsing is synchronous: tar's Parser emits
 * entries as the buffer is written.
 */
export function untarToFiles(buffer: Buffer, stats?: UntarStats): ScanFile[] {
  const files: ScanFile[] = [];
  const parser = new Parser({
    onReadEntry(entry) {
      const path = entry.type === "File" ? safePath(entry.path.split("/").slice(1).join("/")) : null;
      if (path === null || path === "") {
        entry.resume();
        return;
      }
      // an entry past the scan size cap is never buffered; scan.ts would skip it anyway
      if (entry.size > MAX_BYTES) {
        if (stats) stats.skippedLarge++;
        entry.resume();
        return;
      }
      if (files.length >= MAX_FILES) {
        if (stats) stats.truncated = true;
        entry.resume();
        return;
      }
      const chunks: Buffer[] = [];
      entry.on("data", (c: Buffer) => chunks.push(c));
      entry.on("end", () => {
        files.push({ path, text: Buffer.concat(chunks).toString("utf8") });
      });
    },
  });
  parser.end(buffer);
  return files;
}
