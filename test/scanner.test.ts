import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadLocalDir } from "../src/scanner/local.ts";
import { scanFiles } from "../src/scanner/scan.ts";
import type { ScanResult } from "../src/scanner/types.ts";
import { MINI_REGISTRY } from "./mini-registry.ts";

function fixtureDir(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** { path: ["<line>:<matched>", ...] } sorted by line then matched, for stable comparison */
function byFile(result: ScanResult): Record<string, string[]> {
  const out: Record<string, Array<{ line: number; matched: string }>> = {};
  for (const f of result.findings) {
    (out[f.path] ??= []).push({ line: f.line, matched: f.matched });
  }
  const formatted: Record<string, string[]> = {};
  for (const [path, hits] of Object.entries(out)) {
    hits.sort((a, b) => a.line - b.line || (a.matched < b.matched ? -1 : 1));
    formatted[path] = hits.map((h) => `${h.line}:${h.matched}`);
  }
  return formatted;
}

describe("fixture-repo", async () => {
  const files = await loadLocalDir(fixtureDir("fixture-repo"));
  const result = scanFiles(files, MINI_REGISTRY);

  it("finds every planted exposure, per file", () => {
    expect(byFile(result)).toEqual({
      ".env.example": ["2:ASSISTANT_ID env var", "2:asst_ id literal"],
      ".github/workflows/nightly.yml": ["16:gemini-2.0-flash-001"],
      "src/assistant.js": [
        "6:openai.beta.assistants",
        "7:gpt-4-turbo",
        "15:openai.beta.threads",
        "19:createAndPoll",
        "19:openai.beta.threads",
      ],
      "src/assistant_flow.py": [
        "9:ASSISTANT_ID env var",
        "13:client.beta.threads",
        "14:client.beta.threads",
        "17:client.beta.threads",
        "18:ASSISTANT_ID env var",
        "22:client.beta.threads",
        "23:client.beta.threads",
        "29:/v1/assistants",
        "32:OpenAI-Beta: assistants header",
      ],
      "src/claude_client.py": ["8:claude-3-5-sonnet-20241022"],
      "src/opus_params.py": ["10:temperature"],
      "src/summarize.ts": ["7:gpt-5-2025-08-07"],
    });
  });

  it("counts scanned and skipped files", () => {
    expect(result.filesScanned).toBe(9);
    expect(result.filesSkipped).toBe(1);
  });

  it("produces nothing for docs/notes.md and package-lock.json", () => {
    const paths = new Set(result.findings.map((f) => f.path));
    expect(paths.has("docs/notes.md")).toBe(false);
    expect(paths.has("package-lock.json")).toBe(false);
  });

  it("gates param findings on a qualifying claude model in the same file", () => {
    const paramFindings = result.findings.filter(
      (f) => f.registryId === "anthropic:param:temperature-top-p-top-k",
    );
    expect(paramFindings).toHaveLength(1);
    expect(paramFindings[0]).toMatchObject({
      path: "src/opus_params.py",
      line: 10,
      matched: "temperature",
      surface: "param",
    });
    // src/safe.py has temperature=0.7 on a gpt model: no param finding
    expect(result.findings.some((f) => f.path === "src/safe.py")).toBe(false);
  });

  it("attributes the env asst_ literal and the workflow finding to the right rows", () => {
    const envHits = result.findings.filter((f) => f.path === ".env.example");
    expect(envHits.every((h) => h.registryId === "openai:endpoint:assistants-api")).toBe(true);
    const workflowHit = result.findings.find((f) => f.path === ".github/workflows/nightly.yml");
    expect(workflowHit).toMatchObject({
      registryId: "google:model:gemini-2.0-flash-001",
      status: "retired",
      matched: "gemini-2.0-flash-001",
    });
  });
});

describe("clean-repo", async () => {
  const files = await loadLocalDir(fixtureDir("clean-repo"));
  const result = scanFiles(files, MINI_REGISTRY);

  it("scans to zero findings", () => {
    expect(result.findings).toEqual([]);
    expect(result.filesScanned).toBe(3);
    expect(result.filesSkipped).toBe(0);
  });
});

describe("boundary rule", () => {
  it("does not fire gpt-4-turbo inside gpt-4-turbo-preview", () => {
    const result = scanFiles(
      [{ path: "a.ts", text: 'const model = "gpt-4-turbo-preview";\n' }],
      MINI_REGISTRY,
    );
    expect(result.findings).toEqual([]);
  });

  it("still fires on the exact id", () => {
    const result = scanFiles(
      [{ path: "a.ts", text: 'const model = "gpt-4-turbo";\n' }],
      MINI_REGISTRY,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].matched).toBe("gpt-4-turbo");
  });
});
