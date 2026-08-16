import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import {
  createPrRecord,
  markOnboarded,
  setOnboardingPr,
  sql,
  upsertInstallation,
  upsertRepo,
} from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { daysUntil, groupByEvent, repoFindings, repoIndex } from "../src/dashboard/queries.ts";

// id ranges owned by this file (installations 70xx, repos 71xx); other test
// files run in parallel against the same database.
const INST = 7001;
const OTHER_INST = 7002;
const REPO_DIRTY = 7101;
const REPO_CLEAN = 7102;
const REPO_PENDING = 7103;
const REPO_FOREIGN = 7104;

// deterministic countdown math: today is pinned, never the wall clock
const TODAY = "2026-08-16";
const PAST = "2026-06-01";
const SOON = "2026-08-26"; // 10 days out
const LATER = "2026-09-15"; // 30 days out

const GPT4_32K = "openai:model:gpt-4-32k";
const ASSISTANTS = "openai:endpoint:assistants-api";
const CLAUDE_2 = "anthropic:model:claude-2";

async function seedFinding(
  repoId: number,
  registryId: string,
  o: { path?: string; line?: number; dies?: string | null; status?: string; prId?: number | null } = {},
): Promise<void> {
  await sql`
    insert into findings
      (repo_id, registry_id, surface, path, line, matched, dies, dies_is_earliest, status, pr_id)
    values
      (${repoId}, ${registryId}, ${"model"}, ${o.path ?? "src/llm.ts"}, ${o.line ?? 1},
       ${registryId.split(":")[2]}, ${o.dies ?? null}, ${false}, ${o.status ?? "open"}, ${o.prId ?? null})`;
}

async function seed(): Promise<void> {
  await upsertInstallation(INST, "acme");
  await upsertInstallation(OTHER_INST, "rival");
  await upsertRepo({ id: REPO_DIRTY, installationId: INST, owner: "acme", name: "dirty", defaultBranch: "main", private: true });
  await upsertRepo({ id: REPO_CLEAN, installationId: INST, owner: "acme", name: "clean", defaultBranch: "main" });
  await upsertRepo({ id: REPO_PENDING, installationId: INST, owner: "acme", name: "pending", defaultBranch: "main" });
  await upsertRepo({ id: REPO_FOREIGN, installationId: OTHER_INST, owner: "rival", name: "foreign", defaultBranch: "main" });
  await markOnboarded(REPO_DIRTY, DEFAULT_CONFIG);
  await markOnboarded(REPO_CLEAN, DEFAULT_CONFIG);
  await setOnboardingPr(REPO_PENDING, 7);

  const prId = await createPrRecord({
    repoId: REPO_DIRTY,
    number: 44,
    deprecationEvent: ASSISTANTS,
    branch: "aidep/assistants-api",
    evalStatus: "held",
  });

  // dead: dies in the past
  await seedFinding(REPO_DIRTY, GPT4_32K, { dies: PAST, line: 3 });
  // dying later, still open
  await seedFinding(REPO_DIRTY, CLAUDE_2, { dies: LATER, line: 5 });
  // dying soon with an open migration PR
  await seedFinding(REPO_DIRTY, ASSISTANTS, { path: "src/assist.ts", dies: SOON, status: "pr_open", prId: Number(prId) });
  // same event, but a workflow file: stays open even while the PR is up
  await seedFinding(REPO_DIRTY, ASSISTANTS, { path: ".github/workflows/ci.yml", dies: SOON });
  // resolved findings never count
  await seedFinding(REPO_DIRTY, GPT4_32K, { dies: PAST, line: 9, status: "resolved" });

  await seedFinding(REPO_FOREIGN, GPT4_32K, { dies: PAST });
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  // Not TRUNCATE: test files share one database and may run in parallel, so
  // each file only deletes its own id range (cascades to repos/findings/prs).
  await sql`delete from installations where id between 7000 and 7999`;
  await seed();
});

describe("repoIndex", () => {
  it("rolls up per repo and only covers the user's installations", async () => {
    const rows = await repoIndex([INST], TODAY);
    expect(rows.map((r) => r.name)).toEqual(["dirty", "clean", "pending"]);

    expect(rows[0]).toMatchObject({
      owner: "acme",
      name: "dirty",
      private: true,
      open_findings: 4, // resolved one excluded
      dead_findings: 1,
      next_dies: SOON,
      open_prs: 1,
    });
    expect(rows[1]).toMatchObject({
      name: "clean",
      private: false,
      open_findings: 0,
      dead_findings: 0,
      next_dies: null,
      open_prs: 0,
    });
    expect(rows[1].onboarded_at).not.toBeNull();
    expect(rows[2]).toMatchObject({ name: "pending", onboarded_at: null, onboarding_pr_number: 7 });
  });

  it("retired beats date: a past-dies finding flags dead, next_dies skips it", async () => {
    const [dirty] = await repoIndex([INST], TODAY);
    expect(dirty.dead_findings).toBeGreaterThan(0);
    // min over FUTURE dies only; the past date must not leak in as "next"
    expect(dirty.next_dies).toBe(SOON);
  });

  it("returns nothing for an empty installation set", async () => {
    expect(await repoIndex([], TODAY)).toEqual([]);
  });
});

describe("repoFindings + groupByEvent", () => {
  it("orders by urgency and carries the PR linkage", async () => {
    const rows = await repoFindings(REPO_DIRTY);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ registry_id: GPT4_32K, dies: PAST, status: "open", pr_number: null });

    const prRow = rows.find((r) => r.status === "pr_open");
    expect(prRow).toMatchObject({ registry_id: ASSISTANTS, pr_number: 44, eval_status: "held" });
  });

  it("groups by deprecation event, most urgent first", async () => {
    const groups = groupByEvent(await repoFindings(REPO_DIRTY));
    expect(groups.map((g) => g.registryId)).toEqual([GPT4_32K, ASSISTANTS, CLAUDE_2]);

    const assistants = groups[1];
    expect(assistants.findings).toHaveLength(2);
    expect(assistants.pr).toEqual({ number: 44, evalStatus: "held" });
    // the workflow-file finding stays open inside the pr_open event
    expect(
      assistants.findings.some((f) => f.status === "open" && f.path.startsWith(".github/workflows/")),
    ).toBe(true);

    expect(groups[0].pr).toBeNull();
    expect(groups[2].pr).toBeNull();
  });
});

describe("daysUntil", () => {
  it("does date-only arithmetic", () => {
    expect(daysUntil(SOON, TODAY)).toBe(10);
    expect(daysUntil(LATER, TODAY)).toBe(30);
    expect(daysUntil(PAST, TODAY)).toBe(-76);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
  });
});
