import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadLocalDir } from "../src/scanner/local.ts";
import { isTestPath, renderMarkdownReport } from "../src/scanner/report.ts";
import { scanFiles } from "../src/scanner/scan.ts";
import { MINI_REGISTRY } from "./mini-registry.ts";

const fixtureRepo = fileURLToPath(new URL("./fixtures/fixture-repo", import.meta.url));

describe("renderMarkdownReport", async () => {
  const files = await loadLocalDir(fixtureRepo);
  const result = scanFiles(files, MINI_REGISTRY);
  const report = renderMarkdownReport(result, { now: "2026-08-16", repoLabel: "acme/fixture-repo" });

  it("frames retired rows as failing today and counts down live ones", () => {
    expect(report).toContain("calls fail today");
    expect(report).toContain("retired 2025-10-28");
    expect(report).toContain("dies 2026-08-26 (10 days)");
    expect(report).toContain("dies 2026-10-23 (68 days) (earliest possible date)");
    expect(report).toContain("dies 2026-12-11 (117 days)");
    expect(report).toContain("Replacement: gpt-5.6-sol");
  });

  it("orders sections soonest-death first: retired, then dies asc, dateless last", () => {
    const order = [
      "## claude-3-5-sonnet-20241022 (anthropic)",
      "## gemini-2.0-flash-001 (google)",
      "## assistants-api (openai)",
      "## gpt-4-turbo (openai)",
      "## gpt-5-2025-08-07 (openai)",
      "## temperature-top-p-top-k (anthropic)",
    ];
    const positions = order.map((h) => report.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("flags workflow files as manual-migration paths", () => {
    expect(report).toContain(
      ".github/workflows/nightly.yml: workflow file; aidep will not edit this path; migrate manually",
    );
  });

  it("includes the scanned/skipped footer", () => {
    expect(report).toContain("Files scanned: 8, skipped: 2");
  });

  it("leads with one computed summary line", () => {
    expect(report).toContain("**21 findings in 7 files · 2 dead · 18 dying · nearest 2026-08-26 (10 days)**");
  });

  it("shows ten rows of a long event and folds the rest", () => {
    expect(report).toContain("<summary>6 more</summary>");
    // the eleventh row sits inside the fold, not the visible table
    const fold = report.indexOf("<summary>6 more</summary>");
    expect(report.indexOf("| src/assistant_flow.py | 18 | ASSISTANT_ID env var |")).toBeGreaterThan(fold);
  });

  it("matches snapshot", () => {
    expect(report).toMatchSnapshot();
  });
});

describe("test-path demotion", () => {
  const files = [
    { path: "src/chat.py", text: 'model = "claude-3-5-sonnet-20241022"\n' },
    { path: "test/chat.test.py", text: 'model = "claude-3-5-sonnet-20241022"\n' },
    { path: "test/fixtures/old.py", text: 'model = "gemini-2.0-flash-001"\n' },
  ];
  const report = renderMarkdownReport(scanFiles(files, MINI_REGISTRY), { now: "2026-08-16" });

  it("classifies test paths by directory segment or basename", () => {
    for (const p of [
      "test/x.py",
      "src/__tests__/x.ts",
      "spec/x.rb",
      "test/fixtures/repo/src/x.py",
      "test/__snapshots__/x.snap",
      "src/x.test.ts",
      "src/x.spec.js",
    ]) {
      expect(isTestPath(p), p).toBe(true);
    }
    for (const p of ["src/x.py", "app/test.py", "src/testing.ts", "contest/x.py"]) {
      expect(isTestPath(p), p).toBe(false);
    }
  });

  it("keeps the production hit as the lead and folds the test hit under it", () => {
    expect(report).toContain("## claude-3-5-sonnet-20241022 (anthropic)");
    expect(report).toContain("**retired 2025-10-28; calls fail today**");
    expect(report).toContain("| src/chat.py | 1 | claude-3-5-sonnet-20241022 |");
    const fold = report.indexOf("<summary>also in 1 test file</summary>");
    expect(fold).toBeGreaterThan(0);
    expect(report.indexOf("| test/chat.test.py | 1 |")).toBeGreaterThan(fold);
  });

  it("moves an event seen only in test code to the folded block and does not shout", () => {
    const block = report.indexOf("<summary>1 deprecation seen only in test code (1 finding in 1 file)</summary>");
    expect(block).toBeGreaterThan(report.indexOf("## claude-3-5-sonnet-20241022"));
    expect(report.indexOf("### gemini-2.0-flash-001 (google)")).toBeGreaterThan(block);
    expect(report).toContain("\nretired 2026-06-01\n");
    expect(report).not.toContain("retired 2026-06-01; calls fail today");
  });

  it("counts the summary over every finding, test code included", () => {
    expect(report).toContain("**3 findings in 3 files · 3 dead · 0 dying**");
  });
});
