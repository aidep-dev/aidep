import { readFileSync } from "node:fs";
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
        "6:.beta.assistants",
        "7:gpt-4-turbo",
        "18:.beta.threads",
        "22:.beta.threads",
        "22:createAndPoll",
        "25:.beta.threads",
      ],
      "src/assistant_flow.py": [
        "9:ASSISTANT_ID env var",
        "13:.beta.threads",
        "14:.beta.threads",
        "17:.beta.threads",
        "18:ASSISTANT_ID env var",
        "22:.beta.threads",
        "23:.beta.threads",
        "29:/v1/assistants",
        "32:OpenAI-Beta: assistants header",
      ],
      "src/claude_client.py": ["8:claude-3-5-sonnet-20241022"],
      "src/opus_params.py": ["10:temperature"],
      "src/summarize.ts": ["7:gpt-5-2025-08-07"],
    });
  });

  it("counts scanned and skipped files", () => {
    expect(result.filesScanned).toBe(8);
    expect(result.filesSkipped).toBe(2); // package-lock.json, docs/notes.md
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

describe("real-world regression: receiver naming", () => {
  // ComposioHQ/composio python/providers/openai/openai_assistant_demo.py at
  // 03429c74, the file a human migrated by hand in PR #4165 on 2026-08-18.
  // aidep originally found ZERO exposures here because the client variable is
  // named `openai_client`, and the matchers required the receiver to be
  // literally `client` or `openai`. Caught by diffing against that migration.
  const composio = readFileSync(
    fileURLToPath(new URL("./fixtures/real-world/composio-assistant-demo.py", import.meta.url)),
    "utf8",
  );

  it("finds the Assistants calls regardless of what the client is named", () => {
    const found = scanFiles([{ path: "demo.py", text: composio }], MINI_REGISTRY);
    expect(found.findings.length).toBeGreaterThan(0);
    expect(found.findings.some((f) => f.matched === ".beta.assistants")).toBe(true);
    expect(found.findings.some((f) => f.matched === ".beta.threads")).toBe(true);
  });

  it("matches every receiver shape real code uses", () => {
    for (const line of [
      "client.beta.assistants.create()",
      "openai.beta.threads.create()",
      "openai_client.beta.assistants.create()",
      "self.client.beta.threads.create()",
      "oai.beta.threads.create()",
      "_client.beta.threads.create()",
      "this.openai.beta.threads.messages.create()",
    ]) {
      const n = scanFiles([{ path: "x.py", text: line }], MINI_REGISTRY).findings.length;
      expect(n, line).toBeGreaterThan(0);
    }
  });

  it("still ignores prose and unrelated beta namespaces", () => {
    for (const line of [
      "# beta.assistants is gone",
      "client.beta.chat.completions.create()",
      "const beta = { threads: 1 }",
    ]) {
      const n = scanFiles([{ path: "x.py", text: line }], MINI_REGISTRY).findings.length;
      expect(n, line).toBe(0);
    }
  });
});

describe("real-world regression: precision", () => {
  // 2026-08-19. Qualifying nine candidate repos for outreach, three were
  // flagged as exposed while containing no OpenAI Assistants code at all
  // (coze-js, mixedbread-ts, anymodel), and a fourth reported 43% false
  // findings. Telling a maintainer their code breaks when it does not is
  // worse than missing them, so each of these is a permanent guard.
  const clean = (label: string, text: string) =>
    it(`stays clean: ${label}`, () => {
      expect(scanFiles([{ path: "f.ts", text }], MINI_REGISTRY).findings).toEqual([]);
    });

  // coze-js: Coze's own /v3/chat API, nothing to do with OpenAI
  clean("another vendor's submit_tool_outputs path", 'const u = `/v3/chat/submit_tool_outputs?id=${id}`;');
  // mixedbread-ts and anymodel: createAndPoll is a stock Stainless codegen name
  clean("a polling helper in a non-OpenAI SDK", "async createAndPoll(id) { return this.poll(id); }");
  // raven: ordinary snake_case, not OpenAI object ids
  clean("snake_case identifiers that start run_/thread_", "from x import run_document_ai_processor");
  clean("thread_channel variable", 'thread_channel = frappe.get_doc("Raven Channel")');
  // anymodel: short/dictionary model ids as bare words
  clean("dictionary-word model id in prose", "# the davinci era is over");
  clean("two-character model id as a variable", "const o1 = compute();");
  // our own repo, 2026-08-21: every `ada` in a doc comment was reported as a
  // failing call, and the same id mismatched across quote styles
  clean("dictionary-word id in backticks", "/** legacy ids like `ada` and `davinci` are English */");
  clean("dictionary-word id across mismatched quotes", `const s = "ada' + 'x";`);

  it("fires on a dictionary-word id only inside matched quotes", () => {
    for (const text of ['model: "ada"', "model = 'ada'"]) {
      const found = scanFiles([{ path: "f.py", text }], MINI_REGISTRY).findings;
      expect(found.map((f) => f.matched), text).toEqual(["ada"]);
    }
  });

  it("never scans prose files", () => {
    for (const path of ["ROADMAP.md", "docs/guide.mdx", "notes.rst", "CHANGES.txt"]) {
      const text = '`ada` points at `babbage-002`. Set model: "gpt-4-turbo" to reproduce.';
      expect(scanFiles([{ path, text }], MINI_REGISTRY).findings, path).toEqual([]);
    }
  });

  it("still fires on helpers when the file has real OpenAI context", () => {
    const text = 'import OpenAI from "openai";\nconst r = await run.createAndPoll(id);\n';
    const found = scanFiles([{ path: "f.ts", text }], MINI_REGISTRY).findings;
    expect(found.some((f) => f.matched === "createAndPoll")).toBe(true);
  });

  it("still fires on a genuine OpenAI object id", () => {
    const text = 'const t = "thread_9kQvXcR2mNbF7yT1wZ8pL3dJ";';
    expect(scanFiles([{ path: "f.ts", text }], MINI_REGISTRY).findings).toHaveLength(1);
  });

  it("still fires on a non-distinctive model id when it is quoted", () => {
    const found = scanFiles([{ path: "f.py", text: 'model = "gpt-4-turbo"' }], MINI_REGISTRY);
    expect(found.findings).toHaveLength(1);
  });

  it("catches the Ruby keyword-arg form the dot-chain patterns miss", () => {
    // alexrudall/ruby-openai lib/openai/assistants.rb, 45M downloads, missed entirely
    const text = "@client = client.beta(assistants: OpenAI::Assistants::BETA_VERSION)\n";
    const found = scanFiles([{ path: "assistants.rb", text }], MINI_REGISTRY).findings;
    expect(found.some((f) => f.matched === "beta(assistants:)")).toBe(true);
  });
});
