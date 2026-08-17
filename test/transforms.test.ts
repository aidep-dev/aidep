import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RegistryRow } from "../src/registry.ts";
import { transformForEvent } from "../src/transforms/index.ts";
import type { EventTransformResult } from "../src/transforms/types.ts";

function fixture(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/transforms/${rel}`, import.meta.url)), "utf8");
}

// Inline copies of the real registry rows (../aidep-registry/registry as of
// 2026-08-16) so the suite stays hermetic: no network, no sibling checkout.
const ASSISTANTS_ROW: RegistryRow = {
  id: "openai:endpoint:assistants-api",
  provider: "openai",
  surface: "endpoint",
  api_ids: [
    "client.beta.assistants",
    "client.beta.threads",
    "openai.beta.assistants",
    "openai.beta.threads",
    "/v1/assistants",
    "/v1/threads",
    "OpenAI-Beta: assistants",
  ],
  status: "deprecated",
  announced: "2025-08-20",
  dies: "2026-08-26",
  dies_is_earliest_possible: false,
  replacement_id: null,
  replacement_notes: "Responses API + Conversations API",
  migration_url: "https://developers.openai.com/api/docs/assistants/migration",
  source_url: "https://developers.openai.com/api/docs/deprecations",
  verified_at: "2026-08-16",
  platform: "first-party",
};

const SONNET_ROW: RegistryRow = {
  id: "anthropic:model:claude-3-5-sonnet-20241022",
  provider: "anthropic",
  surface: "model",
  api_ids: ["claude-3-5-sonnet-20241022"],
  status: "retired",
  announced: "2025-08-13",
  dies: "2025-10-28",
  dies_is_earliest_possible: false,
  replacement_id: "claude-sonnet-4-6",
  replacement_notes: null,
  migration_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  source_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  verified_at: "2026-08-16",
  platform: "first-party",
};

const OPUS41_ROW: RegistryRow = {
  id: "anthropic:model:claude-opus-4-1-20250805",
  provider: "anthropic",
  surface: "model",
  api_ids: ["claude-opus-4-1-20250805"],
  status: "retired",
  announced: "2026-06-05",
  dies: "2026-08-05",
  dies_is_earliest_possible: false,
  replacement_id: "claude-opus-4-8",
  replacement_notes: null,
  migration_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  source_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  verified_at: "2026-08-16",
  platform: "first-party",
};

const PARAMS_ROW: RegistryRow = {
  id: "anthropic:param:temperature-top-p-top-k",
  provider: "anthropic",
  surface: "param",
  api_ids: ["temperature", "top_p", "top_k"],
  status: "deprecated",
  announced: null,
  dies: null,
  dies_is_earliest_possible: false,
  replacement_id: null,
  replacement_notes:
    "omit temperature/top_p/top_k on Claude Opus 4.7+ and newer; non-default values return 400. Use prompting instead.",
  migration_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  source_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  verified_at: "2026-08-16",
  platform: "first-party",
};

const GPT4_TURBO_ROW: RegistryRow = {
  id: "openai:model:gpt-4-turbo",
  provider: "openai",
  surface: "model",
  api_ids: ["gpt-4-turbo", "gpt-4-turbo-2024-04-09", "gpt-4-turbo-completions"],
  status: "deprecated",
  announced: "2026-04-22",
  dies: "2026-10-23",
  dies_is_earliest_possible: false,
  replacement_id: "gpt-5.6-sol",
  replacement_notes: null,
  migration_url: null,
  source_url: "https://developers.openai.com/api/docs/deprecations",
  verified_at: "2026-08-16",
  platform: "first-party",
};

const O1_PRO_ROW: RegistryRow = {
  id: "openai:model:o1-pro-2025-03-19",
  provider: "openai",
  surface: "model",
  api_ids: ["o1-pro-2025-03-19", "o1-pro"],
  status: "deprecated",
  announced: "2026-04-22",
  dies: "2026-10-23",
  dies_is_earliest_possible: false,
  replacement_id: "gpt-5.6-sol",
  replacement_notes: "reasoning.mode: pro",
  migration_url: null,
  source_url: "https://developers.openai.com/api/docs/deprecations",
  verified_at: "2026-08-16",
  platform: "first-party",
};

const ALL_ROWS = [ASSISTANTS_ROW, SONNET_ROW, OPUS41_ROW, PARAMS_ROW, GPT4_TURBO_ROW, O1_PRO_ROW];

interface Case {
  name: string;
  event: RegistryRow;
  input: string;
  expected: string;
  path: string;
}

const CASES: Case[] = [
  { name: "python-textbook-dance", event: ASSISTANTS_ROW, input: "input.py", expected: "expected.py", path: "src/assistant_flow.py" },
  { name: "js-createandpoll-with-inline-create", event: ASSISTANTS_ROW, input: "input.js", expected: "expected.js", path: "src/assistant.js" },
  { name: "python-partial-dance", event: ASSISTANTS_ROW, input: "input.py", expected: "expected.py", path: "src/kickoff.py" },
  { name: "model-swap-simple", event: SONNET_ROW, input: "input.py", expected: "expected.py", path: "src/claude_client.py" },
  { name: "model-swap-to-47-with-temperature", event: OPUS41_ROW, input: "input.py", expected: "expected.py", path: "src/opus_reply.py" },
  { name: "param-only", event: PARAMS_ROW, input: "input.py", expected: "expected.py", path: "src/opus_params.py" },
  { name: "js-boundary-no-swap", event: GPT4_TURBO_ROW, input: "input.js", expected: "expected.js", path: "src/draft.js" },
  // appended (keep earlier indices stable; CASES[0..6] are referenced by index)
  { name: "nested-python-dance", event: ASSISTANTS_ROW, input: "input.py", expected: "expected.py", path: "src/nested.py" },
  { name: "python-async-dance", event: ASSISTANTS_ROW, input: "input.py", expected: "expected.py", path: "src/async_flow.py" },
  { name: "model-swap-param-scope", event: OPUS41_ROW, input: "input.py", expected: "expected.py", path: "src/replies.py" },
];

function run(c: Case): { input: string; result: EventTransformResult } {
  const input = fixture(`${c.name}/${c.input}`);
  return { input, result: transformForEvent(c.event, [{ path: c.path, content: input }], ALL_ROWS) };
}

describe("snapshot fixtures", () => {
  for (const c of CASES) {
    it(`${c.name} matches the expected file byte-for-byte`, () => {
      const { input, result } = run(c);
      const expected = fixture(`${c.name}/${c.expected}`);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].migrated ?? input).toBe(expected);
    });
  }
});

describe("python-textbook-dance", () => {
  const { result } = run(CASES[0]);

  it("drops the poll loop and the messages.list plumbing", () => {
    const out = result.files[0].migrated!;
    expect(out).not.toContain("runs.create");
    expect(out).not.toContain("while run.status");
    expect(out).not.toContain("messages.list");
    expect(out).toContain("response.output_text");
  });

  it("env-configured assistant gets the fetch-and-inline script and checklist", () => {
    expect(result.generatedFiles.map((g) => g.path)).toEqual(["aidep/fetch-and-inline.mjs"]);
    expect(result.eventChecklist.map((c) => c.id)).toContain("assistants-fetch-and-inline");
  });
});

describe("js-createandpoll-with-inline-create", () => {
  const { result } = run(CASES[1]);
  const ft = result.files[0];

  it("inlines model/instructions and translates file_search vector stores", () => {
    expect(ft.migrated).toContain('tools: [{ type: "file_search", vector_store_ids: ["vs_review_docs"] }]');
    expect(ft.migrated).not.toContain("assistants.create");
    expect(ft.migrated).not.toContain("tool_resources");
  });

  it("removes the dead helper and puts callers on the checklist", () => {
    expect(ft.migrated).not.toContain("createReviewAssistant");
    expect(ft.checklist.map((c) => c.id)).toContain("assistants-removed-create-helper");
  });

  it("no fetch-and-inline script when the config lives in code", () => {
    expect(result.generatedFiles).toEqual([]);
  });
});

describe("python-partial-dance", () => {
  const { result } = run(CASES[2]);
  const ft = result.files[0];

  it("leaves an unrecognized dance byte-identical: no threads.create rename, no rewrite", () => {
    // renaming threads.create without rewriting the run loop would ship a
    // broken hybrid (conversations.create + the old messages/runs loop)
    expect(ft.migrated).toBeNull();
  });

  it("checklist names the file and the calls that were and were not seen", () => {
    const manual = ft.checklist.find((c) => c.id === "assistants-manual-run-loop");
    expect(manual).toBeDefined();
    expect(manual!.text).toContain("manual: rewrite the run loop in src/kickoff.py");
    expect(manual!.text).toContain("missing messages.list");
    expect(manual!.text).toContain("saw messages.create, runs.create, runs.retrieve (poll)");
  });
});

describe("model swaps", () => {
  it("model-swap-simple records the swap row", () => {
    const { result } = run(CASES[3]);
    expect(result.files[0].swaps).toEqual([{ old: "claude-3-5-sonnet-20241022", new: "claude-sonnet-4-6" }]);
  });

  it("swap onto a 4.7+ model also drops temperature and says why", () => {
    const { result } = run(CASES[4]);
    const ft = result.files[0];
    expect(ft.migrated).not.toContain("temperature");
    expect(ft.applied.some((a) => a.kind === "param-drop")).toBe(true);
    const note = ft.checklist.find((c) => c.id === "model-params-dropped");
    expect(note).toBeDefined();
    expect(note!.text).toContain("400");
  });

  it("boundary: gpt-4-turbo row never rewrites gpt-4-turbo-preview", () => {
    const { result } = run(CASES[6]);
    expect(result.files[0].migrated).toBeNull();
    expect(result.files[0].swaps).toEqual([]);
    expect(result.eventChecklist).toEqual([]);
  });

  it("null replacement becomes a pick-a-replacement checklist item, file untouched", () => {
    const row: RegistryRow = {
      ...GPT4_TURBO_ROW,
      replacement_id: null,
      replacement_notes: "gpt-5.6-sol or gpt-5.6-luna",
    };
    const result = transformForEvent(row, [{ path: "a.ts", content: 'const model = "gpt-4-turbo";\n' }], ALL_ROWS);
    expect(result.files[0].migrated).toBeNull();
    const item = result.eventChecklist.find((c) => c.id === "model-pick-replacement");
    expect(item).toBeDefined();
    expect(item!.text).toContain("pick a replacement");
    expect(item!.text).toContain("gpt-5.6-sol or gpt-5.6-luna");
  });

  it("reasoning.mode: pro in replacement_notes adds the reasoning checklist item", () => {
    const result = transformForEvent(
      O1_PRO_ROW,
      [{ path: "a.ts", content: 'const model = "o1-pro";\n' }],
      ALL_ROWS,
    );
    expect(result.files[0].migrated).toContain("gpt-5.6-sol");
    const item = result.eventChecklist.find((c) => c.id === "model-reasoning-mode-pro");
    expect(item).toBeDefined();
    expect(item!.text).toContain('reasoning: {"mode": "pro"}');
  });
});

describe("param removal edge cases", () => {
  it("computed values are left intact and land on the checklist with file:line", () => {
    const content = [
      "import anthropic",
      "",
      "message = client.messages.create(",
      '    model="claude-opus-4-8",',
      "    temperature=cfg.temp,",
      "    max_tokens=100,",
      ")",
      "",
    ].join("\n");
    const result = transformForEvent(PARAMS_ROW, [{ path: "src/x.py", content }], ALL_ROWS);
    const ft = result.files[0];
    expect(ft.migrated).toBeNull();
    expect(ft.checklist).toHaveLength(1);
    expect(ft.checklist[0].id).toBe("param-manual");
    expect(ft.checklist[0].text).toContain("src/x.py:5");
  });

  it("no removal in files that do not pin a 4.7+ model", () => {
    const content = 'client.messages.create(model="claude-sonnet-4-6", temperature=0.3)\n';
    const result = transformForEvent(PARAMS_ROW, [{ path: "src/x.py", content }], ALL_ROWS);
    expect(result.files[0].migrated).toBeNull();
    expect(result.files[0].checklist).toEqual([]);
  });

  it("JS property and JSON-ish forms are removed with comma cleanup", () => {
    const content = [
      'const model = "claude-opus-4-8";',
      "const res = await client.messages.create({ model, temperature: 0.5, max_tokens: 10 });",
      'const body = { "model": model, "top_p": 0.9 };',
      "",
    ].join("\n");
    const result = transformForEvent(PARAMS_ROW, [{ path: "src/x.ts", content }], ALL_ROWS);
    const out = result.files[0].migrated!;
    expect(out).toContain("create({ model, max_tokens: 10 })");
    expect(out).toContain('{ "model": model }');
  });
});

describe("assistants extras", () => {
  it("submit_tool_outputs, streaming, and truncation_strategy always reach the checklist", () => {
    const content = [
      "const run = await openai.beta.threads.runs.stream(threadId, { assistant_id: id });",
      'if (run.status === "requires_action") await run.submit_tool_outputs([]);',
      "const opts = { truncation_strategy: { type: 'last_messages' } };",
      "",
    ].join("\n");
    const result = transformForEvent(ASSISTANTS_ROW, [{ path: "src/stream.js", content }], ALL_ROWS);
    const ids = result.eventChecklist.map((c) => c.id);
    expect(ids).toContain("assistants-function-calling");
    expect(ids).toContain("assistants-streaming");
    expect(ids).toContain("assistants-truncation-strategy");
    const fc = result.eventChecklist.find((c) => c.id === "assistants-function-calling")!;
    expect(fc.text).toContain("https://developers.openai.com/api/docs/guides/function-calling");
  });

  it("stored thread ids trigger the backfill checklist and script", () => {
    const content = 'const t = await openai.beta.threads.retrieve("thread_abc123DEF");\n';
    const result = transformForEvent(ASSISTANTS_ROW, [{ path: "src/history.js", content }], ALL_ROWS);
    expect(result.eventChecklist.map((c) => c.id)).toContain("assistants-thread-backfill");
    const gen = result.generatedFiles.find((g) => g.path === "aidep/backfill-threads.mjs");
    expect(gen).toBeDefined();
    // ours warns and skips what OpenAI's recipe drops silently
    expect(gen!.content).toContain("image_file");
    expect(gen!.content).toContain("attachment");
    expect(gen!.content).toContain("stderr");
    expect(gen!.content).toContain('"order", "asc"');
    expect(gen!.content).toContain("input_text");
    expect(gen!.content).toContain("output_text");
    expect(gen!.content).toContain("input_image");
  });

  it("code_interpreter create is left alone with a checklist explaining the container model", () => {
    const content = [
      "const assistant = await openai.beta.assistants.create({",
      '  model: "gpt-4-turbo",',
      '  instructions: "x",',
      '  tools: [{ type: "code_interpreter" }],',
      "});",
      "",
    ].join("\n");
    const result = transformForEvent(ASSISTANTS_ROW, [{ path: "src/ci.js", content }], ALL_ROWS);
    const ft = result.files[0];
    expect(ft.migrated).toBeNull();
    const item = ft.checklist.find((c) => c.id === "assistants-inline-partial");
    expect(item).toBeDefined();
    expect(item!.text).toContain("code_interpreter");
    expect(item!.text).toContain("20-minute idle expiry");
  });
});

describe("event-level metadata", () => {
  it("dies_is_earliest_possible adds the earliest-possible note", () => {
    const row: RegistryRow = { ...GPT4_TURBO_ROW, dies_is_earliest_possible: true };
    const result = transformForEvent(row, [{ path: "a.ts", content: 'const m = "gpt-4-turbo";\n' }], ALL_ROWS);
    const item = result.eventChecklist.find((c) => c.id === "earliest-possible-date");
    expect(item).toBeDefined();
    expect(item!.text).toContain("2026-10-23");
    expect(item!.text).toContain("earliest-possible");
  });
});

describe("prompt objects are never emitted", () => {
  it("no transform output or generated file mentions prompt ids", () => {
    const outputs: string[] = [];
    for (const c of CASES) {
      const { result } = run(c);
      for (const f of result.files) {
        if (f.migrated !== null) outputs.push(f.migrated);
        for (const item of f.checklist) outputs.push(item.text);
        for (const a of f.applied) outputs.push(a.description);
      }
      for (const item of result.eventChecklist) outputs.push(item.text);
      for (const g of result.generatedFiles) outputs.push(g.content);
    }
    expect(outputs.length).toBeGreaterThan(0);
    for (const text of outputs) {
      expect(text).not.toContain('prompt={"id"');
      expect(text).not.toContain("prompt_id");
    }
  });
});

describe("assistants.create removal never orphans live code", () => {
  const content = [
    'import OpenAI from "openai";',
    "",
    "const openai = new OpenAI();",
    "",
    "export async function setup(threadId, question) {",
    "  const assistant = await openai.beta.assistants.create({",
    '    model: "gpt-4-turbo",',
    '    instructions: "Help.",',
    "  });",
    "  db.saveAssistantId(assistant.id);",
    '  console.log("created", assistant.id);',
    "  await openai.beta.threads.messages.create(threadId, {",
    '    role: "user",',
    "    content: question,",
    "  });",
    "  const run = await openai.beta.threads.runs.createAndPoll(threadId, {",
    "    assistant_id: assistant.id,",
    "  });",
    "  const messages = await openai.beta.threads.messages.list(threadId);",
    "  return messages.data[0].content[0].text.value;",
    "}",
    "",
  ].join("\n");
  const result = transformForEvent(ASSISTANTS_ROW, [{ path: "src/setup.js", content }], ALL_ROWS);
  const ft = result.files[0];

  it("keeps the create call when its id is used elsewhere", () => {
    // deleting just the create statement would dangle db.saveAssistantId(assistant.id)
    expect(ft.migrated).toContain("beta.assistants.create(");
    expect(ft.migrated).toContain("db.saveAssistantId(assistant.id)");
    expect(ft.migrated).toContain('console.log("created", assistant.id)');
  });

  it("still inlines the config into responses.create and rewrites the dance", () => {
    expect(ft.migrated).toContain("openai.responses.create({");
    expect(ft.migrated).toContain('model: "gpt-4-turbo"');
    expect(ft.migrated).not.toContain("messages.list");
    expect(ft.checklist.map((c) => c.id)).toContain("assistants-inline-partial");
  });
});

describe("model id boundary: urls, paths, docs", () => {
  it("never swaps an id sitting inside a URL/path", () => {
    const content = 'const DOCS = "https://platform.openai.com/docs/models/gpt-4-turbo";\n';
    const result = transformForEvent(GPT4_TURBO_ROW, [{ path: "src/links.ts", content }], ALL_ROWS);
    expect(result.files[0].migrated).toBeNull();
    expect(result.files[0].swaps).toEqual([]);
  });

  it("docs/changelogs get a checklist item, not an edit", () => {
    const content = "# Changelog\n\nUse gpt-4-turbo for now.\n";
    const result = transformForEvent(GPT4_TURBO_ROW, [{ path: "CHANGELOG.md", content }], ALL_ROWS);
    expect(result.files[0].migrated).toBeNull();
    const item = result.files[0].checklist.find((c) => c.id === "model-doc-mention");
    expect(item).toBeDefined();
    expect(item!.text).toContain("gpt-4-turbo");
  });
});

describe("repo-controlled tool type is escaped in the checklist", () => {
  it("a tool type with markdown/HTML is escaped", () => {
    const content = [
      "const a = await openai.beta.assistants.create({",
      '  model: "gpt-4-turbo",',
      '  tools: [{ type: "]<script>" }],',
      "});",
      "",
    ].join("\n");
    const result = transformForEvent(ASSISTANTS_ROW, [{ path: "src/ci.js", content }], ALL_ROWS);
    const item = result.files[0].checklist.find((c) => c.id === "assistants-inline-partial");
    expect(item).toBeDefined();
    expect(item!.text).not.toContain("<script>");
    expect(item!.text).toContain("\\<script\\>");
  });
});

describe("findBlockEnd ignores braces inside comments", () => {
  it("a stray } in a // comment does not cut the function short", () => {
    const content = [
      'import OpenAI from "openai";',
      "const openai = new OpenAI();",
      "",
      "export async function ask(threadId, question) {",
      "  // guard: never pass a raw } to the model",
      "  await openai.beta.threads.messages.create(threadId, {",
      '    role: "user",',
      "    content: question,",
      "  });",
      "  const run = await openai.beta.threads.runs.createAndPoll(threadId, {",
      "    assistant_id: process.env.ASSISTANT_ID,",
      "  });",
      "  const messages = await openai.beta.threads.messages.list(threadId);",
      "  return messages.data[0].content[0].text.value;",
      "}",
      "",
    ].join("\n");
    const result = transformForEvent(ASSISTANTS_ROW, [{ path: "src/ask.js", content }], ALL_ROWS);
    const out = result.files[0].migrated;
    expect(out).not.toBeNull();
    expect(out).toContain("openai.responses.create({");
    expect(out).not.toContain("messages.list");
  });
});

describe("param gate is per-pinned-model, not a file-wide substring", () => {
  it("a 4.7+ model only in a comment does not strip params", () => {
    const content = [
      "import anthropic",
      "",
      "client = anthropic.Anthropic()",
      "",
      "",
      "def draft(prompt: str) -> str:",
      "    # switch to claude-opus-4-8 before the 400s start",
      "    message = client.messages.create(",
      "        model=CURRENT_MODEL,",
      "        max_tokens=512,",
      "        temperature=0.9,",
      '        messages=[{"role": "user", "content": prompt}],',
      "    )",
      "    return message.content[0].text",
      "",
    ].join("\n");
    const result = transformForEvent(PARAMS_ROW, [{ path: "src/draft.py", content }], ALL_ROWS);
    const ft = result.files[0];
    expect(ft.migrated).toBeNull();
    expect(ft.checklist.map((c) => c.id)).toContain("param-gate-manual");
  });

  it("a mix of gated and ungated pins is a checklist, not a strip", () => {
    const content = [
      'a = client.messages.create(model="claude-opus-4-8", temperature=0.2)',
      'b = client.messages.create(model="claude-3-haiku-20240307", temperature=0.7)',
      "",
    ].join("\n");
    const result = transformForEvent(PARAMS_ROW, [{ path: "src/two.py", content }], ALL_ROWS);
    const ft = result.files[0];
    expect(ft.migrated).toBeNull();
    expect(ft.checklist.map((c) => c.id)).toContain("param-gate-manual");
  });

  it("a standalone temperature assignment is never deleted", () => {
    const content = [
      "import anthropic",
      "",
      "client = anthropic.Anthropic()",
      "",
      "temperature = 0.9",
      "",
      "",
      "def draft(prompt: str) -> str:",
      "    message = client.messages.create(",
      '        model="claude-opus-4-8",',
      "        max_tokens=512,",
      '        messages=[{"role": "user", "content": prompt}],',
      "    )",
      "    return message.content[0].text",
      "",
    ].join("\n");
    const result = transformForEvent(PARAMS_ROW, [{ path: "src/cfg.py", content }], ALL_ROWS);
    // the file pins only a gated model, so the gate says "edit", but the
    // standalone `temperature = 0.9` is a statement, not a call kwarg, and
    // must survive (deleting it would orphan later uses)
    expect(result.files[0].migrated ?? content).toContain("temperature = 0.9");
  });
});

describe("generated scripts keep config OpenAI's recipe would drop", () => {
  it("fetch-and-inline prints temperature/top_p/response_format/metadata", () => {
    const { result } = run(CASES[0]);
    const gen = result.generatedFiles.find((g) => g.path === "aidep/fetch-and-inline.mjs");
    expect(gen).toBeDefined();
    for (const field of ["temperature", "top_p", "response_format", "metadata"]) {
      expect(gen!.content).toContain(field);
    }
  });

  it("backfill skips assistant-role image_url instead of sending input_image", () => {
    const content = 'const t = await openai.beta.threads.retrieve("thread_abc123DEF");\n';
    const result = transformForEvent(ASSISTANTS_ROW, [{ path: "src/history.js", content }], ALL_ROWS);
    const gen = result.generatedFiles.find((g) => g.path === "aidep/backfill-threads.mjs");
    expect(gen).toBeDefined();
    expect(gen!.content).toContain("assistant-role image_url");
    expect(gen!.content).toContain('m.role === "assistant"');
  });
});
