import type { Finding, ScanResult } from "./types.ts";

const DAY_MS = 86_400_000;

function slug(registryId: string): string {
  const parts = registryId.split(":");
  return parts[parts.length - 1];
}

function isWorkflowPath(path: string): boolean {
  return path.startsWith(".github/workflows/") || path.includes("/.github/workflows/");
}

function statusLine(f: Finding, now: string): string {
  if (f.status === "retired") {
    return f.dies === null
      ? "**retired — calls fail today**"
      : `**retired ${f.dies} — calls fail today**`;
  }
  if (f.dies === null) return "deprecated — no shutdown date announced yet";
  const days = Math.round((Date.parse(f.dies) - Date.parse(now)) / DAY_MS);
  const earliest = f.diesIsEarliestPossible ? " (earliest possible date)" : "";
  return `dies ${f.dies} (${days} days)${earliest}`;
}

export function renderMarkdownReport(
  result: ScanResult,
  opts: { now: string; repoLabel?: string },
): string {
  // group by registryId; result.findings is already sorted, so each group's
  // rows stay in path/line order
  const groups = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const g = groups.get(f.registryId);
    if (g) g.push(f);
    else groups.set(f.registryId, [f]);
  }

  const sections = [...groups.values()].sort((a, b) => {
    const fa = a[0];
    const fb = b[0];
    const retiredA = fa.status === "retired" ? 0 : 1;
    const retiredB = fb.status === "retired" ? 0 : 1;
    if (retiredA !== retiredB) return retiredA - retiredB;
    if (fa.dies !== fb.dies) {
      if (fa.dies === null) return 1;
      if (fb.dies === null) return -1;
      return fa.dies < fb.dies ? -1 : 1;
    }
    return fa.registryId < fb.registryId ? -1 : 1;
  });

  const out: string[] = ["# aidep scan report", ""];
  if (opts.repoLabel !== undefined) out.push(`Repo: ${opts.repoLabel}`, "");
  out.push(`Scan date: ${opts.now}`, "");

  if (sections.length === 0) {
    out.push("No exposures found.", "");
  }

  for (const section of sections) {
    const first = section[0];
    out.push(`## ${slug(first.registryId)} (${first.provider})`, "");
    out.push(statusLine(first, opts.now), "");
    if (first.replacementId !== null) out.push(`Replacement: ${slug(first.replacementId)}`, "");
    if (first.migrationUrl !== null) out.push(`Migration guide: ${first.migrationUrl}`, "");
    out.push("| file | line | matched |", "| --- | --- | --- |");
    for (const f of section) {
      out.push(`| ${f.path} | ${f.line} | ${f.matched} |`);
    }
    out.push("");
    const workflowPaths = [...new Set(section.filter((f) => isWorkflowPath(f.path)).map((f) => f.path))];
    for (const p of workflowPaths) {
      out.push(`${p}: workflow file — aidep will not edit this path; migrate manually`, "");
    }
  }

  out.push(`Files scanned: ${result.filesScanned}, skipped: ${result.filesSkipped}`, "");
  return out.join("\n");
}
