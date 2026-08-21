import type { Finding, ScanResult } from "./types.ts";

const DAY_MS = 86_400_000;

/** Rows shown before the rest of an event's table folds into <details>. */
const VISIBLE_ROWS = 10;

function slug(registryId: string): string {
  const parts = registryId.split(":");
  return parts[parts.length - 1];
}

function isWorkflowPath(path: string): boolean {
  return path.startsWith(".github/workflows/") || path.includes("/.github/workflows/");
}

/**
 * Test code pins dead models on purpose: fixtures, snapshots, mocks, the
 * scanner's own regression cases. Those hits are real and they stay in the
 * report, but they are not the lead. Found 2026-08-21 on aidep-dev/aidep#1:
 * 74% of findings sat under test/ and every one was headed "calls fail today".
 */
const TEST_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "fixtures",
  "fixture",
  "__snapshots__",
  "__mocks__",
  "testdata",
]);
const TEST_BASENAME = /\.(test|spec)\.[^.]+$|\.snap$/;

export function isTestPath(path: string): boolean {
  const segments = path.split("/");
  const base = segments[segments.length - 1];
  return segments.slice(0, -1).some((s) => TEST_SEGMENTS.has(s)) || TEST_BASENAME.test(base);
}

/**
 * Repo paths are hostile input. Backslash-escape the markdown-active
 * punctuation so a path can't break the table (|) or inject links/HTML
 * ([, ], <, >, `). GFM renders `\<` etc. as the literal character.
 */
export function mdEscape(s: string): string {
  return s.replace(/[\\|[\]<>`]/g, "\\$&");
}

function daysUntil(dies: string, now: string): number {
  return Math.round((Date.parse(dies) - Date.parse(now)) / DAY_MS);
}

function isDead(f: Finding, now: string): boolean {
  return f.status === "retired" || (f.dies !== null && f.dies <= now);
}

/** `live` is whether any production-path file hits this event; a retirement
 * that only shows up in test code is stated, not shouted. */
function statusLine(f: Finding, now: string, live: boolean): string {
  if (f.status === "retired") {
    const when = f.dies === null ? "retired" : `retired ${f.dies}`;
    return live ? `**${when}; calls fail today**` : when;
  }
  if (f.dies === null) return "deprecated; no shutdown date announced yet";
  const earliest = f.diesIsEarliestPossible ? " (earliest possible date)" : "";
  return `dies ${f.dies} (${daysUntil(f.dies, now)} days)${earliest}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One line a stranger can read before the tables: what the landing page
 * mockup shows, computed from the scan instead of typed. */
function summaryLine(findings: Finding[], now: string): string {
  const files = new Set(findings.map((f) => f.path)).size;
  const dead = findings.filter((f) => isDead(f, now)).length;
  const dated = findings.filter(
    (f): f is Finding & { dies: string } => !isDead(f, now) && f.dies !== null,
  );
  const nearest = dated.map((f) => f.dies).sort()[0];
  const parts = [
    `${plural(findings.length, "finding")} in ${plural(files, "file")}`,
    `${dead} dead`,
    `${dated.length} dying`,
  ];
  if (nearest !== undefined) parts.push(`nearest ${nearest} (${daysUntil(nearest, now)} days)`);
  return `**${parts.join(" · ")}**`;
}

function table(rows: Finding[]): string[] {
  return [
    "| file | line | matched |",
    "| --- | --- | --- |",
    ...rows.map((f) => `| ${mdEscape(f.path)} | ${f.line} | ${mdEscape(f.matched)} |`),
  ];
}

/** GFM needs the blank line after <summary> for the markdown inside to render. */
function details(summary: string, body: string[]): string[] {
  const inner = [...body];
  while (inner[inner.length - 1] === "") inner.pop();
  return ["<details>", `<summary>${summary}</summary>`, "", ...inner, "", "</details>"];
}

function renderEvent(
  section: Finding[],
  now: string,
  opts: { heading: "##" | "###"; foldTests: boolean },
): string[] {
  const first = section[0];
  const prod = section.filter((f) => !isTestPath(f.path));
  const test = section.filter((f) => isTestPath(f.path));
  const out = [`${opts.heading} ${slug(first.registryId)} (${first.provider})`, ""];
  out.push(statusLine(first, now, prod.length > 0), "");
  if (first.replacementId !== null) out.push(`Replacement: ${slug(first.replacementId)}`, "");
  if (first.migrationUrl !== null) out.push(`Migration guide: ${first.migrationUrl}`, "");

  if (prod.length > 0) {
    out.push(...table(prod.slice(0, VISIBLE_ROWS)), "");
    if (prod.length > VISIBLE_ROWS) {
      out.push(...details(`${prod.length - VISIBLE_ROWS} more`, table(prod.slice(VISIBLE_ROWS))), "");
    }
  }
  if (test.length > 0) {
    const files = new Set(test.map((f) => f.path)).size;
    const rows = table(test);
    if (opts.foldTests) {
      out.push(...details(`also in ${plural(files, "test file")}`, rows), "");
    } else {
      out.push(...rows, "");
    }
  }

  const workflowPaths = [...new Set(section.filter((f) => isWorkflowPath(f.path)).map((f) => f.path))];
  for (const p of workflowPaths) {
    out.push(`${mdEscape(p)}: workflow file; aidep will not edit this path; migrate manually`, "");
  }
  return out;
}

export function renderMarkdownReport(
  result: ScanResult,
  opts: { now: string; repoLabel?: string; header?: boolean },
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

  const out: string[] = [];
  if (opts.header !== false) {
    out.push("# aidep scan report", "");
    if (opts.repoLabel !== undefined) out.push(`Repo: ${opts.repoLabel}`, "");
  }
  out.push(`Scan date: ${opts.now}`, "");

  if (sections.length === 0) {
    out.push("No exposures found.", "");
  } else {
    out.push(summaryLine(result.findings, opts.now), "");
  }

  // Events with a production-path hit lead, in death order. Events seen only
  // in test code fold into one block at the end, same order inside.
  const live = sections.filter((s) => s.some((f) => !isTestPath(f.path)));
  const testOnly = sections.filter((s) => s.every((f) => isTestPath(f.path)));

  for (const section of live) {
    out.push(...renderEvent(section, opts.now, { heading: "##", foldTests: true }));
  }
  if (testOnly.length > 0) {
    const findings = testOnly.flat();
    const files = new Set(findings.map((f) => f.path)).size;
    out.push(
      ...details(
        `${plural(testOnly.length, "deprecation")} seen only in test code (${plural(findings.length, "finding")} in ${plural(files, "file")})`,
        testOnly.flatMap((s) => renderEvent(s, opts.now, { heading: "###", foldTests: false })),
      ),
      "",
    );
  }

  out.push(`Files scanned: ${result.filesScanned}, skipped: ${result.filesSkipped}`, "");
  return out.join("\n");
}
