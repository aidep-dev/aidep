import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AidepConfigSchema } from "../src/config.ts";
import {
  createPrRecord,
  markOnboarded,
  sql,
  upsertInstallation,
  upsertRepo,
} from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { buildMigrationPr, replaceEvalSection } from "../src/github/migration.ts";
import type { RepoTarget } from "../src/github/types.ts";
import { runJob, setExtractionLlmForTesting } from "../src/pipeline.ts";
import type { EventTransformResult } from "../src/transforms/types.ts";
import { MINI_REGISTRY } from "./mini-registry.ts";

// Hermetic registry: the pipeline resolves events through loadRegistry; the
// mini-registry keeps titles/dates/links stable for the snapshot below.
vi.mock("../src/registry.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/registry.ts")>()),
  loadRegistry: async () => MINI_REGISTRY,
}));

// Recorder octokit behind the one seam pipeline + migration share. Contents
// GETs serve repoFiles on the default branch and branchFiles on aidep/*
// branches (PUTs land in branchFiles, so re-runs see what they committed).
const state = vi.hoisted(() => ({
  repoFiles: {} as Record<string, string>,
  branchFiles: {} as Record<string, string>,
  prBody: "",
  /** state returned by GET pulls/{pull_number}; rerun no-ops unless "open" */
  prState: "open",
  requests: [] as Array<{ route: string; params: Record<string, unknown> }>,
  puts: [] as Array<{ path: string; content: string; branch: string }>,
}));

vi.mock("../src/github/octokit.ts", () => ({
  installationOctokit: vi.fn(async () => ({
    request: async (route: string, params: Record<string, unknown> = {}) => {
      state.requests.push({ route, params });
      switch (route) {
        case "GET /repos/{owner}/{repo}/git/ref/{ref}":
          return { data: { object: { sha: "head-sha-50" } } };
        case "POST /repos/{owner}/{repo}/git/refs":
          return { data: {} };
        case "GET /repos/{owner}/{repo}/contents/{path}": {
          const path = params.path as string;
          const store = params.ref === "main" ? state.repoFiles : state.branchFiles;
          const text = store[path];
          if (text === undefined) throw Object.assign(new Error("Not Found"), { status: 404 });
          return {
            data: {
              sha: `sha-${path}`,
              encoding: "base64",
              content: Buffer.from(text, "utf8").toString("base64"),
            },
          };
        }
        case "PUT /repos/{owner}/{repo}/contents/{path}": {
          const path = params.path as string;
          const content = Buffer.from(params.content as string, "base64").toString("utf8");
          state.branchFiles[path] = content;
          state.puts.push({ path, content, branch: params.branch as string });
          return { data: {} };
        }
        case "POST /repos/{owner}/{repo}/pulls":
          return { data: { number: 55 } };
        case "GET /repos/{owner}/{repo}/pulls/{pull_number}":
          return { data: { number: params.pull_number, state: state.prState, body: state.prBody } };
        case "PATCH /repos/{owner}/{repo}/pulls/{pull_number}":
          return { data: {} };
        default:
          throw new Error(`unexpected route ${route}`);
      }
    },
  })),
}));

// id ranges owned by this file (installation 5001, repos 51xx); other test
// files run in parallel against the same database.
const INST = 5001;
const REPO_ASSISTANTS = 5101;
const REPO_EVAL = 5102;
const REPO_CAP = 5103;
const REPO_INGEST = 5104;
const REPO_RERUN = 5105;
const REPO_NO_KEY = 5106;

const ASSISTANTS = "openai:endpoint:assistants-api";
const GPT5 = "openai:model:gpt-5-2025-08-07";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const JS_ASSISTANT = readFileSync(join(fixturesDir, "fixture-repo/src/assistant.js"), "utf8");
const PY_ASSISTANT = readFileSync(join(fixturesDir, "fixture-repo/src/assistant_flow.py"), "utf8");
const TS_SUMMARIZE = readFileSync(join(fixturesDir, "fixture-repo/src/summarize.ts"), "utf8");

const CANNED_CASE = JSON.stringify([
  {
    description: "summarize ticket",
    prompt: "Summarize this ticket: {{text}}",
    vars: [{ text: "printer exploded" }],
    checks: { contains: "ticket" },
  },
]);

const reqs = (route: string) => state.requests.filter((r) => r.route === route);

async function seedRepo(repoId: number, config: Record<string, unknown> = {}): Promise<void> {
  await upsertInstallation(INST, "acme");
  await upsertRepo({ id: repoId, installationId: INST, owner: "acme", name: `r${repoId}`, defaultBranch: "main" });
  await markOnboarded(repoId, AidepConfigSchema.parse(config));
}

async function seedFinding(
  repoId: number,
  registryId: string,
  path: string,
  opts: { status?: string; prId?: number } = {},
): Promise<void> {
  const surface = registryId.split(":")[1];
  await sql`
    insert into findings (repo_id, registry_id, surface, path, line, matched, status, pr_id)
    values (${repoId}, ${registryId}, ${surface}, ${path}, 1, ${registryId.split(":")[2]},
            ${opts.status ?? "open"}, ${opts.prId ?? null})`;
}

function job(type: "create_migration_pr" | "rerun_pr" | "ingest_eval_results", payload: Record<string, unknown>) {
  return runJob({ id: 1, type, payload, attempts: 1 });
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`delete from installations where id between 5000 and 5999`;
  await sql`delete from jobs where (payload->>'repoId')::bigint between 5100 and 5199`;
  state.repoFiles = {};
  state.branchFiles = {};
  state.prBody = "";
  state.prState = "open";
  state.requests = [];
  state.puts = [];
});

afterEach(() => {
  setExtractionLlmForTesting(null);
});

describe("create_migration_pr", () => {
  it("opens the assistants migration PR end to end", async () => {
    await seedRepo(REPO_ASSISTANTS, { evals: true });
    await seedFinding(REPO_ASSISTANTS, ASSISTANTS, "src/assistant.js");
    await seedFinding(REPO_ASSISTANTS, ASSISTANTS, "src/assistant_flow.py");
    state.repoFiles = { "src/assistant.js": JS_ASSISTANT, "src/assistant_flow.py": PY_ASSISTANT };
    setExtractionLlmForTesting(() => async () => CANNED_CASE);

    await job("create_migration_pr", { repoId: REPO_ASSISTANTS, registryId: ASSISTANTS });

    // branch off the default head; provider-surface-slug name avoids collisions
    const [refCreate] = reqs("POST /repos/{owner}/{repo}/git/refs");
    expect(refCreate.params).toMatchObject({
      ref: "refs/heads/aidep/openai-endpoint-assistants-api",
      sha: "head-sha-50",
    });

    // migrated files PUT on the branch
    const js = state.puts.find((p) => p.path === "src/assistant.js");
    expect(js?.branch).toBe("aidep/openai-endpoint-assistants-api");
    expect(js?.content).toContain("responses.create");
    expect(js?.content).not.toContain("beta.assistants");
    const py = state.puts.find((p) => p.path === "src/assistant_flow.py");
    expect(py?.content).toContain("responses.create");
    expect(py?.content).toContain("conversations.create");

    // the PR itself
    const [prPost] = reqs("POST /repos/{owner}/{repo}/pulls");
    expect(prPost.params).toMatchObject({
      head: "aidep/openai-endpoint-assistants-api",
      base: "main",
      title: "Migrate 2 OpenAI Assistants API calls before the Aug 26 shutdown",
    });
    const body = prPost.params.body as string;
    // assistants eval pack compares the same model via chat vs the Responses
    // API, so the eval exercises the new API path
    expect(body).toContain("**Eval: pending.**");
    expect(body).toContain("openai:chat:gpt-4-turbo vs openai:responses:gpt-4-turbo");
    const baseline = JSON.parse(state.branchFiles["evals/promptfooconfig.baseline.json"]);
    expect(baseline.providers).toEqual(["openai:chat:gpt-4-turbo"]);
    const evalConfig = JSON.parse(state.branchFiles["evals/promptfooconfig.json"]);
    expect(evalConfig.providers).toEqual(["openai:responses:gpt-4-turbo"]);
    expect(body).toContain("## Changes");
    expect(body).toContain("## Manual checklist");
    expect(body).toContain("- [ ] createReviewAssistant() in src/assistant.js was removed");
    expect(body).toContain(
      "- [ ] <!-- aidep-rerun -->Check this box to have aidep re-run the migration on the current default branch.",
    );
    expect(body).toMatch(/<!-- aidep:body-hash:[0-9a-f]{64} -->$/);
    expect(body).toMatchSnapshot();

    // db: pr tracked, findings flipped to pr_open and linked
    const [pr] = await sql<Array<{ id: number; number: number; branch: string; deprecation_event: string; eval_status: string }>>`
      select * from prs where repo_id = ${REPO_ASSISTANTS}`;
    expect(pr).toMatchObject({
      number: 55,
      branch: "aidep/openai-endpoint-assistants-api",
      deprecation_event: ASSISTANTS,
      eval_status: "pending",
    });
    const findings = await sql<Array<{ status: string; pr_id: number }>>`
      select status, pr_id from findings where repo_id = ${REPO_ASSISTANTS}`;
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.status === "pr_open" && Number(f.pr_id) === Number(pr.id))).toBe(true);
  });

  it("ships the evals pack on a model swap when evals are enabled", async () => {
    await seedRepo(REPO_EVAL, { evals: true });
    await seedFinding(REPO_EVAL, GPT5, "src/summarize.ts");
    state.repoFiles = { "src/summarize.ts": TS_SUMMARIZE };
    setExtractionLlmForTesting(() => async () => CANNED_CASE);

    await job("create_migration_pr", { repoId: REPO_EVAL, registryId: GPT5 });

    const put = state.puts.find((p) => p.path === "src/summarize.ts");
    expect(put?.content).toContain("gpt-5.6-sol");
    expect(put?.content).not.toContain("gpt-5-2025-08-07");
    const evalPaths = state.puts.map((p) => p.path).filter((p) => p.startsWith("evals/"));
    expect(evalPaths.sort()).toEqual([
      "evals/build-asserts.mjs",
      "evals/promptfooconfig.baseline.json",
      "evals/promptfooconfig.json",
      "evals/prompts.json",
      "evals/report.mjs",
      "evals/tests.json",
      "evals/workflows/aidep-eval.yml",
    ]);
    const config = JSON.parse(state.branchFiles["evals/promptfooconfig.json"]);
    expect(config.providers).toEqual(["openai:chat:gpt-5.6-sol"]);
    expect(config.defaultTest).toEqual({ options: { provider: "anthropic:messages:claude-sonnet-4-6" } });

    const [prPost] = reqs("POST /repos/{owner}/{repo}/pulls");
    expect(prPost.params.title).toBe("Replace gpt-5-2025-08-07 with gpt-5.6-sol before Dec 11, 2026");
    const body = prPost.params.body as string;
    expect(body).toContain("**Eval: pending.**");
    expect(body).toContain("gpt-5-2025-08-07 vs gpt-5.6-sol");
    expect(body).toContain("Judge: anthropic:messages:claude-sonnet-4-6 (a different model family than the one under test).");
    // eval block sits at the top, before the changes table
    expect(body.indexOf("## Eval")).toBeLessThan(body.indexOf("## Changes"));

    const [pr] = await sql<Array<{ eval_status: string }>>`select eval_status from prs where repo_id = ${REPO_EVAL}`;
    expect(pr.eval_status).toBe("pending");
  });

  it("skips the pack with the no-key reason when the extraction key is missing", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await seedRepo(REPO_NO_KEY, { evals: true });
      await seedFinding(REPO_NO_KEY, GPT5, "src/summarize.ts");
      state.repoFiles = { "src/summarize.ts": TS_SUMMARIZE };

      await job("create_migration_pr", { repoId: REPO_NO_KEY, registryId: GPT5 });

      const body = reqs("POST /repos/{owner}/{repo}/pulls")[0].params.body as string;
      expect(body).toContain("*Eval skipped: extraction key not configured*");
      expect(state.puts.some((p) => p.path.startsWith("evals/"))).toBe(false);
      const [pr] = await sql<Array<{ eval_status: string }>>`select eval_status from prs where repo_id = ${REPO_NO_KEY}`;
      expect(pr.eval_status).toBe("none");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("enforces prCap against branches whose findings are still pr_open", async () => {
    await seedRepo(REPO_CAP, { prCap: 1 });
    const prId = await createPrRecord({
      repoId: REPO_CAP,
      number: 9,
      deprecationEvent: GPT5,
      branch: "aidep/gpt-5-2025-08-07",
    });
    await seedFinding(REPO_CAP, GPT5, "src/summarize.ts", { status: "pr_open", prId: Number(prId) });
    await seedFinding(REPO_CAP, ASSISTANTS, "src/assistant_flow.py");
    state.repoFiles = { "src/assistant_flow.py": PY_ASSISTANT };

    await job("create_migration_pr", { repoId: REPO_CAP, registryId: ASSISTANTS });

    expect(reqs("POST /repos/{owner}/{repo}/pulls")).toHaveLength(0);
    expect(state.puts).toHaveLength(0);
    expect(await sql`select 1 from prs where repo_id = ${REPO_CAP}`).toHaveLength(1);
    const [finding] = await sql<Array<{ status: string }>>`
      select status from findings where repo_id = ${REPO_CAP} and registry_id = ${ASSISTANTS}`;
    expect(finding.status).toBe("open");
  });
});

describe("rerun_pr", () => {
  it("refreshes files and body on the existing branch, idempotently", async () => {
    await seedRepo(REPO_RERUN);
    const prId = await createPrRecord({
      repoId: REPO_RERUN,
      number: 12,
      deprecationEvent: GPT5,
      branch: "aidep/gpt-5-2025-08-07",
    });
    await seedFinding(REPO_RERUN, GPT5, "src/summarize.ts", { status: "pr_open", prId: Number(prId) });
    state.repoFiles = { "src/summarize.ts": TS_SUMMARIZE };
    state.branchFiles = { "src/summarize.ts": "stale content from the first run" };

    await job("rerun_pr", { repoId: REPO_RERUN, prNumber: 12 });

    const [put] = state.puts;
    expect(put).toMatchObject({ path: "src/summarize.ts", branch: "aidep/gpt-5-2025-08-07" });
    expect(put.content).toContain("gpt-5.6-sol");
    // no second PR; the existing one gets a fresh body with the box unchecked
    expect(reqs("POST /repos/{owner}/{repo}/pulls")).toHaveLength(0);
    const [patch] = reqs("PATCH /repos/{owner}/{repo}/pulls/{pull_number}");
    expect(patch.params.pull_number).toBe(12);
    expect(patch.params.body as string).toContain("- [ ] <!-- aidep-rerun -->");

    // second run: branch content already current, so no new commit
    state.puts = [];
    await job("rerun_pr", { repoId: REPO_RERUN, prNumber: 12 });
    expect(state.puts).toHaveLength(0);
  });

  it("no-ops on a closed PR: no branch write, no body patch", async () => {
    await seedRepo(REPO_RERUN);
    const prId = await createPrRecord({
      repoId: REPO_RERUN,
      number: 13,
      deprecationEvent: GPT5,
      branch: "aidep/gpt-5-2025-08-07",
    });
    await seedFinding(REPO_RERUN, GPT5, "src/summarize.ts", { status: "pr_open", prId: Number(prId) });
    state.repoFiles = { "src/summarize.ts": TS_SUMMARIZE };
    state.prState = "closed";

    await job("rerun_pr", { repoId: REPO_RERUN, prNumber: 13 });

    expect(state.puts).toHaveLength(0);
    expect(reqs("PATCH /repos/{owner}/{repo}/pulls/{pull_number}")).toHaveLength(0);
    expect(reqs("POST /repos/{owner}/{repo}/git/refs")).toHaveLength(0);
    // finding untouched
    const [f] = await sql<Array<{ status: string }>>`select status from findings where repo_id = ${REPO_RERUN}`;
    expect(f.status).toBe("pr_open");
  });

  it("links newly-appeared open findings for the event to the PR", async () => {
    await seedRepo(REPO_RERUN);
    const prId = await createPrRecord({
      repoId: REPO_RERUN,
      number: 14,
      deprecationEvent: GPT5,
      branch: "aidep/gpt-5-2025-08-07",
    });
    await seedFinding(REPO_RERUN, GPT5, "src/summarize.ts", { status: "pr_open", prId: Number(prId) });
    // appeared since the PR was opened: still 'open', not linked
    await seedFinding(REPO_RERUN, GPT5, "src/other.ts", { status: "open" });
    state.repoFiles = { "src/summarize.ts": TS_SUMMARIZE, "src/other.ts": TS_SUMMARIZE };

    await job("rerun_pr", { repoId: REPO_RERUN, prNumber: 14 });

    const findings = await sql<Array<{ status: string; pr_id: number }>>`
      select status, pr_id from findings where repo_id = ${REPO_RERUN}`;
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.status === "pr_open" && Number(f.pr_id) === Number(prId))).toBe(true);
  });
});

describe("ingest_eval_results", () => {
  it("stores the verdict and rewrites the PR body's Eval section", async () => {
    await seedRepo(REPO_INGEST);
    await createPrRecord({
      repoId: REPO_INGEST,
      number: 41,
      deprecationEvent: GPT5,
      branch: "aidep/gpt-5-2025-08-07",
      evalStatus: "pending",
    });
    state.branchFiles["evals/results.json"] = JSON.stringify({
      judge: "anthropic:claude-sonnet-4-6",
      summary: { held: 2, drifted: 0, inconclusive: 0, total: 2 },
      cases: [
        { description: "summarize ticket", verdict: "held", details: "" },
        { description: "rank items [1]", verdict: "held", details: "" },
      ],
    });
    state.prBody = [
      "This PR replaces gpt-5-2025-08-07 with gpt-5.6-sol in 1 file.",
      "",
      "## Eval",
      "",
      "**Eval: pending.** blah.",
      "",
      "Judge: anthropic:claude-sonnet-4-6.",
      "",
      "## Changes",
      "",
      "| file | change | dies |",
    ].join("\n");

    await job("ingest_eval_results", { repoId: REPO_INGEST, prNumber: null, branch: "aidep/gpt-5-2025-08-07" });

    const [pr] = await sql<Array<{ eval_status: string; eval_summary: Record<string, number> }>>`
      select eval_status, eval_summary from prs where repo_id = ${REPO_INGEST}`;
    expect(pr.eval_status).toBe("held");
    expect(pr.eval_summary).toEqual({ held: 2, drifted: 0, inconclusive: 0, total: 2 });

    const [patch] = reqs("PATCH /repos/{owner}/{repo}/pulls/{pull_number}");
    expect(patch.params.pull_number).toBe(41);
    const body = patch.params.body as string;
    expect(body).toContain("**Behavior held on 2/2 prompts.**");
    expect(body).toContain("Judge: anthropic:claude-sonnet-4-6.");
    expect(body).toContain("- held: summarize ticket");
    expect(body).not.toContain("**Eval: pending.**");
    // everything around the Eval section survives the rewrite
    expect(body).toContain("This PR replaces gpt-5-2025-08-07");
    expect(body).toContain("## Changes");
  });

  it("skips results whose summary counts do not reconcile", async () => {
    await seedRepo(REPO_INGEST);
    await createPrRecord({
      repoId: REPO_INGEST,
      number: 42,
      deprecationEvent: GPT5,
      branch: "aidep/gpt-5-2025-08-07",
      evalStatus: "pending",
    });
    // held + drifted + inconclusive = 1, but total says 5
    state.branchFiles["evals/results.json"] = JSON.stringify({
      judge: "anthropic:claude-sonnet-4-6",
      summary: { held: 1, drifted: 0, inconclusive: 0, total: 5 },
      cases: [{ description: "x", verdict: "held", details: "" }],
    });
    state.prBody = "## Eval\n\n**Eval: pending.**\n\n## Changes\n";

    await job("ingest_eval_results", { repoId: REPO_INGEST, prNumber: null, branch: "aidep/gpt-5-2025-08-07" });

    const [pr] = await sql<Array<{ eval_status: string }>>`select eval_status from prs where repo_id = ${REPO_INGEST}`;
    expect(pr.eval_status).toBe("pending"); // verdict not overwritten
    expect(reqs("PATCH /repos/{owner}/{repo}/pulls/{pull_number}")).toHaveLength(0);
  });
});

describe("replaceEvalSection", () => {
  it("appends the section when the body has no Eval heading, never dropping it", () => {
    const body = "Summary line.\n\n## Changes\n\n| a |\n";
    const out = replaceEvalSection(body, "## Eval\n\nresult here.\n\n");
    expect(out).toContain("## Eval");
    expect(out).toContain("result here.");
    expect(out).toContain("## Changes"); // original body preserved
  });

  it("replaces an existing Eval section in place", () => {
    const body = "S\n\n## Eval\n\nold.\n\n## Changes\n\nx\n";
    const out = replaceEvalSection(body, "## Eval\n\nnew.\n\n");
    expect(out).toContain("new.");
    expect(out).not.toContain("old.");
    expect(out).toContain("## Changes");
  });
});

describe("buildMigrationPr", () => {
  const repo: RepoTarget = { owner: "acme", name: "widgets", defaultBranch: "main" };
  const claudeEvent = MINI_REGISTRY.find((r) => r.id === "anthropic:model:claude-3-5-sonnet-20241022")!;
  const paramEvent = MINI_REGISTRY.find((r) => r.id === "anthropic:param:temperature-top-p-top-k")!;

  const swapResult: EventTransformResult = {
    files: [
      {
        path: "src/[evil]|path.py",
        migrated: "model = 'claude-sonnet-4-6'\n",
        applied: [{ kind: "model-swap", description: "swapped" }],
        checklist: [],
        swaps: [{ old: "claude-3-5-sonnet-20241022", new: "claude-sonnet-4-6" }],
      },
    ],
    eventChecklist: [],
    generatedFiles: [{ path: "aidep/tool.mjs", content: "// tool\n" }],
  };
  const cannedPack = [{ path: "evals/tests.json", content: "[]\n" }];

  it("builds the retired-model title, branch, files, and a pending eval block", () => {
    const built = buildMigrationPr({
      repo,
      event: claudeEvent,
      result: swapResult,
      evalPack: cannedPack,
      evalSkipReason: null,
      now: "2026-08-16",
    });
    expect(built.title).toBe("Replace retired model claude-3-5-sonnet-20241022 with claude-sonnet-4-6");
    expect(built.branch).toBe("aidep/anthropic-model-claude-3-5-sonnet-20241022");
    expect(built.files.map((f) => f.path)).toEqual([
      "src/[evil]|path.py",
      "aidep/tool.mjs",
      "evals/tests.json",
    ]);
    expect(built.body).toContain("**Eval: pending.**");
    expect(built.body).toContain("claude-3-5-sonnet-20241022 vs claude-sonnet-4-6");
    // anthropic under test -> openai judge (cross-family)
    expect(built.body).toContain("Judge: openai:chat:gpt-5.6-sol");
    // section order: summary, eval, changes, links, checkbox, hash
    const order = [
      "## Eval",
      "## Changes",
      "Provider announcement: ",
      "- [ ] <!-- aidep-rerun -->",
      "<!-- aidep:body-hash:",
    ];
    const positions = order.map((s) => built.body.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("escapes repo-derived cells in the swap table", () => {
    const built = buildMigrationPr({
      repo,
      event: claudeEvent,
      result: swapResult,
      evalPack: null,
      evalSkipReason: null,
      now: "2026-08-16",
    });
    expect(built.body).toContain("| src/\\[evil\\]\\|path.py | claude-3-5-sonnet-20241022 → claude-sonnet-4-6 | 2025-10-28 |");
    expect(built.body).not.toContain("| src/[evil]|path.py |");
    // no eval pack and no skip reason: no Eval section at all
    expect(built.body).not.toContain("## Eval");
  });

  it("uses the fixed param-event title and dedupes checklist items", () => {
    const result: EventTransformResult = {
      files: [
        {
          path: "src/a.py",
          migrated: "x",
          applied: [{ kind: "param-drop", description: "removed temperature (line 3) in src/a.py" }],
          checklist: [{ id: "param-manual", text: "same item" }],
          swaps: [],
        },
        {
          path: "src/b.py",
          migrated: "y",
          applied: [{ kind: "param-drop", description: "removed top_p (line 9) in src/b.py" }],
          checklist: [{ id: "param-manual", text: "same item" }],
          swaps: [],
        },
      ],
      eventChecklist: [],
      generatedFiles: [],
    };
    const built = buildMigrationPr({
      repo,
      event: paramEvent,
      result,
      evalPack: null,
      evalSkipReason: null,
      now: "2026-08-16",
    });
    expect(built.title).toBe("Drop deprecated sampling params for Claude 4.7+");
    expect((built.body.match(/- \[ \] same item/g) ?? []).length).toBe(1);
  });
});
