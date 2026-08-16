import type { RegistryRow } from "../registry.ts";
import type { Finding, ScanFile, ScanResult } from "./types.ts";
import { buildPatterns, PARAM_MODEL_GATE } from "./patterns.ts";

const LOCKFILE_BASENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "bun.lockb",
  "composer.lock",
  "Gemfile.lock",
]);

const SKIP_SEGMENTS = new Set(["node_modules", "vendor", ".git", "dist", "build", ".next"]);

const MAX_BYTES = 1024 * 1024;

function shouldSkip(file: ScanFile): boolean {
  const segments = file.path.split("/");
  if (LOCKFILE_BASENAMES.has(segments[segments.length - 1])) return true;
  if (segments.some((s) => SKIP_SEGMENTS.has(s))) return true;
  if (Buffer.byteLength(file.text, "utf8") > MAX_BYTES) return true;
  if (file.text.slice(0, 8192).includes("\u0000")) return true;
  return false;
}

function toFinding(row: RegistryRow, path: string, line: number, matched: string): Finding {
  return {
    registryId: row.id,
    surface: row.surface,
    provider: row.provider,
    path,
    line,
    matched,
    replacementId: row.replacement_id,
    dies: row.dies,
    diesIsEarliestPossible: row.dies_is_earliest_possible,
    status: row.status,
    migrationUrl: row.migration_url,
  };
}

export function scanFiles(files: ScanFile[], rows: RegistryRow[]): ScanResult {
  const matchers = buildPatterns(rows);
  const lineMatchers = matchers.filter((m) => m.kind === "line");
  const paramMatchers = matchers.filter((m) => m.kind === "param");

  const findings: Finding[] = [];
  let filesScanned = 0;
  let filesSkipped = 0;

  for (const file of files) {
    if (shouldSkip(file)) {
      filesSkipped++;
      continue;
    }
    filesScanned++;

    const paramGate = paramMatchers.length > 0 && PARAM_MODEL_GATE.test(file.text);
    const lines = file.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // one finding per (pattern, line); two different ids on a line = two findings
      for (const m of lineMatchers) {
        if (m.regex.test(line)) findings.push(toFinding(m.row, file.path, i + 1, m.display));
      }
      if (paramGate) {
        for (const m of paramMatchers) {
          if (m.regex.test(line)) findings.push(toFinding(m.row, file.path, i + 1, m.display));
        }
      }
    }
  }

  findings.sort((a, b) => {
    if (a.dies !== b.dies) {
      if (a.dies === null) return 1;
      if (b.dies === null) return -1;
      return a.dies < b.dies ? -1 : 1;
    }
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.line - b.line;
  });

  return { findings, filesScanned, filesSkipped };
}
