import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadLocalDir } from "../src/scanner/local.ts";
import { renderMarkdownReport } from "../src/scanner/report.ts";
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
    expect(report).toContain("Files scanned: 9, skipped: 1");
  });

  it("matches snapshot", () => {
    expect(report).toMatchSnapshot();
  });
});
