import { generateKeyPairSync } from "node:crypto";
import { App } from "octokit";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AidepConfigSchema, DEFAULT_CONFIG } from "../src/config.ts";
import {
  createPrRecord,
  getRepo,
  markOnboarded,
  setInstallationSuspended,
  setOnboardingPr,
  setRepoConfig,
  sql,
  upsertInstallation,
  upsertRepo,
} from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { enqueue } from "../src/jobs.ts";
import { registerHandlers } from "../src/github/handlers.ts";
import { setAppForTesting } from "../src/github/app.ts";

// One seam for handler octokit calls; mocked so nothing touches the network.
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("../src/github/octokit.ts", () => ({
  installationOctokit: vi.fn(async () => ({ request: requestMock })),
}));
// The webhook route drains the job queue after responding; keep that inert here.
vi.mock("../src/pipeline.ts", () => ({ runJob: vi.fn(async () => {}) }));

// id ranges owned by this file (installations 20xx, repos 21xx); other test
// files run in parallel against the same database.
const INST = 2001;
const REPO_A = 2101;
const REPO_B = 2102;

let app: App;
let seq = 0;

function receive(name: string, payload: Record<string, unknown>): Promise<void> {
  return app.webhooks.receive({ id: `d-${seq++}`, name, payload } as never);
}

const inst = (id: number) => ({ id, account: { login: "acme" } });

function queuedJobs(type: string, repoId: number) {
  return sql<{ payload: Record<string, unknown> }[]>`
    select payload from jobs
    where type = ${type} and status = 'queued' and (payload->>'repoId')::bigint = ${repoId}`;
}

async function seedRepo(repoId: number, opts: { onboarded?: boolean } = {}): Promise<void> {
  await upsertInstallation(INST, "acme");
  await upsertRepo({ id: repoId, installationId: INST, owner: "acme", name: `r${repoId}`, defaultBranch: "main" });
  if (opts.onboarded) await markOnboarded(repoId, DEFAULT_CONFIG);
}

beforeAll(async () => {
  await migrate();
  // throwaway key generated per run; nothing secret is stored
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  app = new App({ appId: 999001, privateKey: pem, webhooks: { secret: "testsecret" } });
  registerHandlers(app);
  setAppForTesting(app);
});

afterAll(async () => {
  setAppForTesting(null);
  await sql.end();
});

beforeEach(async () => {
  // Not TRUNCATE: test files share one database and may run in parallel, so
  // each file only deletes its own id range (cascades to repos/scans/findings/prs).
  await sql`delete from installations where id between 2000 and 2999`;
  await sql`delete from jobs where (payload->>'repoId')::bigint between 2100 and 2199`;
  requestMock.mockReset();
});

describe("installation lifecycle", () => {
  it("created: upserts installation + repos and enqueues onboard per repo", async () => {
    await receive("installation", {
      action: "created",
      installation: inst(INST),
      repositories: [
        { id: REPO_A, name: "one", full_name: "acme/one" },
        { id: REPO_B, name: "two", full_name: "acme/two" },
      ],
    });
    const [instRow] = await sql`select account_login, suspended_at from installations where id = ${INST}`;
    expect(instRow).toMatchObject({ account_login: "acme", suspended_at: null });
    const repoA = await getRepo(REPO_A);
    expect(repoA).toMatchObject({ owner: "acme", name: "one", default_branch: "main", onboarded_at: null });
    expect(await queuedJobs("onboard", REPO_A)).toHaveLength(1);
    expect(await queuedJobs("onboard", REPO_B)).toHaveLength(1);
  });

  it("installation_repositories added/removed", async () => {
    await seedRepo(REPO_A);
    await receive("installation_repositories", {
      action: "added",
      installation: inst(INST),
      repositories_added: [{ id: REPO_B, name: "two", full_name: "acme/two" }],
      repositories_removed: [],
    });
    expect(await getRepo(REPO_B)).not.toBeNull();
    expect(await queuedJobs("onboard", REPO_B)).toHaveLength(1);

    await receive("installation_repositories", {
      action: "removed",
      installation: inst(INST),
      repositories_added: [],
      repositories_removed: [{ id: REPO_A, name: "one", full_name: "acme/one" }],
    });
    expect(await getRepo(REPO_A)).toBeNull();
    expect(await getRepo(REPO_B)).not.toBeNull();
  });

  it("deleted: purges the installation and its repos", async () => {
    await seedRepo(REPO_A);
    await receive("installation", { action: "deleted", installation: inst(INST) });
    expect(await sql`select 1 from installations where id = ${INST}`).toHaveLength(0);
    expect(await getRepo(REPO_A)).toBeNull();
  });

  it("suspend and unsuspend flip suspended_at", async () => {
    await upsertInstallation(INST, "acme");
    await receive("installation", { action: "suspend", installation: inst(INST) });
    let [row] = await sql`select suspended_at from installations where id = ${INST}`;
    expect(row.suspended_at).not.toBeNull();
    await receive("installation", { action: "unsuspend", installation: inst(INST) });
    [row] = await sql`select suspended_at from installations where id = ${INST}`;
    expect(row.suspended_at).toBeNull();
  });

  it("re-upserting a suspended installation keeps it suspended", async () => {
    await upsertInstallation(INST, "acme");
    await setInstallationSuspended(INST, true);
    // a re-install / webhook redelivery must not silently un-suspend
    await receive("installation", {
      action: "created",
      installation: inst(INST),
      repositories: [],
    });
    const [row] = await sql`select suspended_at from installations where id = ${INST}`;
    expect(row.suspended_at).not.toBeNull();
  });

  it("deleted also purges queued jobs for the installation's repos", async () => {
    await seedRepo(REPO_A);
    await enqueue("scan", { repoId: REPO_A });
    await receive("installation", { action: "deleted", installation: inst(INST) });
    expect(await queuedJobs("scan", REPO_A)).toHaveLength(0);
  });
});

describe("push", () => {
  const push = (repoId: number, ref: string, files: string[] = ["src/x.ts"]) =>
    receive("push", {
      ref,
      repository: { id: repoId },
      installation: inst(INST),
      commits: [{ added: [], modified: files, removed: [] }],
    });

  it("default-branch push on an onboarded repo enqueues one scan, deduped", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    await push(REPO_A, "refs/heads/main");
    await push(REPO_A, "refs/heads/main");
    const jobs = await queuedJobs("scan", REPO_A);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ repoId: REPO_A, rereadConfig: false });
  });

  it("flags rereadConfig when the push touches .github/aidep.json", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    await push(REPO_A, "refs/heads/main", [".github/aidep.json"]);
    const jobs = await queuedJobs("scan", REPO_A);
    expect(jobs[0].payload).toMatchObject({ rereadConfig: true });
  });

  it("a config-touching push while a scan is queued still enqueues a follow-up", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    await push(REPO_A, "refs/heads/main"); // first scan queued
    await push(REPO_A, "refs/heads/main", [".github/aidep.json"]); // config change
    const jobs = await queuedJobs("scan", REPO_A);
    expect(jobs).toHaveLength(2);
    expect(jobs.some((j) => j.payload.rereadConfig === true)).toBe(true);
    // a non-config push behind the queue is still debounced
    await push(REPO_A, "refs/heads/main", ["src/z.ts"]);
    expect(await queuedJobs("scan", REPO_A)).toHaveLength(2);
  });

  it("ignores non-default branches, unknown repos, and un-onboarded repos", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    await push(REPO_A, "refs/heads/feature");
    await push(2199, "refs/heads/main"); // no repo row
    await seedRepo(REPO_B); // not onboarded
    await push(REPO_B, "refs/heads/main");
    expect(await queuedJobs("scan", REPO_A)).toHaveLength(0);
    expect(await queuedJobs("scan", REPO_B)).toHaveLength(0);
  });

  it("aidep/* push touching evals/results.json enqueues ingest_eval_results", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    await push(REPO_A, "refs/heads/aidep/fix-1", ["evals/results.json"]);
    const jobs = await queuedJobs("ingest_eval_results", REPO_A);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ prNumber: null, branch: "aidep/fix-1" });
    // same branch without touching results.json: nothing
    await push(REPO_A, "refs/heads/aidep/fix-1", ["src/x.ts"]);
    expect(await queuedJobs("ingest_eval_results", REPO_A)).toHaveLength(1);
  });
});

describe("pull_request.closed (onboarding)", () => {
  const closed = (repoId: number, number: number, merged: boolean) =>
    receive("pull_request", {
      action: "closed",
      number,
      installation: inst(INST),
      repository: { id: repoId },
      pull_request: { number, merged, body: "", head: { ref: "aidep/configure" } },
    });

  it("merged configure PR reads the config and marks the repo onboarded", async () => {
    await seedRepo(REPO_A);
    await setOnboardingPr(REPO_A, 7);
    requestMock.mockResolvedValueOnce({
      data: { content: Buffer.from(JSON.stringify({ schedule: "weekly" })).toString("base64") },
    });
    await closed(REPO_A, 7, true);
    const repo = await getRepo(REPO_A);
    expect(repo?.onboarded_at).not.toBeNull();
    expect(repo?.config).toMatchObject({ schedule: "weekly", ignore: [] });
    expect(requestMock).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/contents/{path}",
      expect.objectContaining({ owner: "acme", path: ".github/aidep.json", ref: "main" }),
    );
  });

  it("closed-unmerged configure PR leaves the repo disabled", async () => {
    await seedRepo(REPO_A);
    await setOnboardingPr(REPO_A, 7);
    await closed(REPO_A, 7, false);
    expect((await getRepo(REPO_A))?.onboarded_at).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("merged non-onboarding PR does nothing", async () => {
    await seedRepo(REPO_A);
    await setOnboardingPr(REPO_A, 7);
    await closed(REPO_A, 8, true);
    expect((await getRepo(REPO_A))?.onboarded_at).toBeNull();
  });

  it("keeps the last-known config when the contents API errors on merge", async () => {
    await seedRepo(REPO_A);
    await setRepoConfig(REPO_A, AidepConfigSchema.parse({ schedule: "weekly" }));
    await setOnboardingPr(REPO_A, 7);
    requestMock.mockRejectedValueOnce(new Error("503 transient"));
    await closed(REPO_A, 7, true);
    const repo = await getRepo(REPO_A);
    expect(repo?.onboarded_at).not.toBeNull();
    // must not stomp the real config with DEFAULT_CONFIG (schedule "daily")
    expect(repo?.config).toMatchObject({ schedule: "weekly" });
  });
});

describe("pull_request.closed/reopened (migration PR)", () => {
  const EVENT = "openai:model:gpt-4-turbo";
  const migrationPr = (action: string, number: number, branch: string) =>
    receive("pull_request", {
      action,
      number,
      installation: inst(INST),
      repository: { id: REPO_A },
      pull_request: { number, merged: false, body: "", head: { ref: branch } },
    });

  async function seedMigrationFinding(prId: number, status: string): Promise<void> {
    await sql`
      insert into findings (repo_id, registry_id, surface, path, line, matched, status, pr_id)
      values (${REPO_A}, ${EVENT}, 'model', 'src/x.ts', 1, 'gpt-4-turbo', ${status},
              ${status === "pr_open" ? prId : null})`;
  }

  it("closed-unmerged migration PR releases its findings back to open", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    const prId = await createPrRecord({
      repoId: REPO_A,
      number: 21,
      deprecationEvent: EVENT,
      branch: "aidep/openai-model-gpt-4-turbo",
    });
    await seedMigrationFinding(Number(prId), "pr_open");

    await migrationPr("closed", 21, "aidep/openai-model-gpt-4-turbo");

    const [f] = await sql`select status, pr_id from findings where repo_id = ${REPO_A}`;
    expect(f.status).toBe("open");
    expect(f.pr_id).toBeNull();
  });

  it("merged migration PR stamps merged_at and leaves its findings to the next scan", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    const prId = await createPrRecord({
      repoId: REPO_A,
      number: 23,
      deprecationEvent: EVENT,
      branch: "aidep/openai-model-gpt-4-turbo",
    });
    await seedMigrationFinding(Number(prId), "pr_open");

    await receive("pull_request", {
      action: "closed",
      number: 23,
      installation: inst(INST),
      repository: { id: REPO_A },
      pull_request: { number: 23, merged: true, body: "", head: { ref: "aidep/openai-model-gpt-4-turbo" } },
    });

    const [pr] = await sql`select merged_at from prs where id = ${prId}`;
    expect(pr.merged_at).not.toBeNull();
    // the rescan after merge resolves them; the handler does not guess
    const [f] = await sql`select status from findings where repo_id = ${REPO_A}`;
    expect(f.status).toBe("pr_open");
  });

  it("reopened migration PR restores its findings to pr_open", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    const prId = await createPrRecord({
      repoId: REPO_A,
      number: 22,
      deprecationEvent: EVENT,
      branch: "aidep/openai-model-gpt-4-turbo",
    });
    await seedMigrationFinding(Number(prId), "open");

    await migrationPr("reopened", 22, "aidep/openai-model-gpt-4-turbo");

    const [f] = await sql`select status, pr_id from findings where repo_id = ${REPO_A}`;
    expect(f.status).toBe("pr_open");
    expect(Number(f.pr_id)).toBe(Number(prId));
  });
});

describe("pull_request.edited (rebase checkbox)", () => {
  const edited = (headRef: string, from: string, body: string) =>
    receive("pull_request", {
      action: "edited",
      number: 12,
      installation: inst(INST),
      repository: { id: REPO_A },
      changes: { body: { from } },
      pull_request: { number: 12, merged: false, body, head: { ref: headRef } },
    });

  it("enqueues rerun_pr when the migration checkbox flips to checked", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    await edited("aidep/gpt-4-turbo", "- [ ] <!-- aidep-rerun -->", "- [x] <!-- aidep-rerun -->");
    const jobs = await queuedJobs("rerun_pr", REPO_A);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ prNumber: 12 });
  });

  it("configure-branch rebase checkbox enqueues an onboarding refresh", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    await edited("aidep/configure", "- [ ] <!-- aidep-rebase -->", "- [x] <!-- aidep-rebase -->");
    const jobs = await queuedJobs("onboard", REPO_A);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ refresh: true });
    expect(await queuedJobs("rerun_pr", REPO_A)).toHaveLength(0);
  });

  it("ignores edits that do not flip the box", async () => {
    await seedRepo(REPO_A, { onboarded: true });
    await edited("aidep/gpt-4-turbo", "- [x] <!-- aidep-rerun -->", "- [x] <!-- aidep-rerun -->");
    await edited("aidep/gpt-4-turbo", "- [x] <!-- aidep-rerun -->", "- [ ] <!-- aidep-rerun -->");
    await edited("aidep/configure", "- [x] <!-- aidep-rebase -->", "- [x] <!-- aidep-rebase -->");
    expect(await queuedJobs("rerun_pr", REPO_A)).toHaveLength(0);
    expect(await queuedJobs("onboard", REPO_A)).toHaveLength(0);
  });
});

describe("webhook route", () => {
  async function post(body: string, signature: string): Promise<Response> {
    const { POST } = await import("../app/api/github/webhook/route.ts");
    return POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "x-github-delivery": "route-1",
          "x-github-event": "installation",
          "x-hub-signature-256": signature,
        },
        body,
      }),
    );
  }

  it("accepts a correctly signed payload and dispatches it", async () => {
    await upsertInstallation(INST, "acme");
    const body = JSON.stringify({ action: "suspend", installation: inst(INST) });
    const { sign } = await import("@octokit/webhooks-methods");
    const res = await post(body, await sign("testsecret", body));
    expect(res.status).toBe(200);
    const [row] = await sql`select suspended_at from installations where id = ${INST}`;
    expect(row.suspended_at).not.toBeNull();
  });

  it("rejects a bad signature with 401", async () => {
    const body = JSON.stringify({ action: "suspend", installation: inst(INST) });
    const res = await post(body, "sha256=" + "0".repeat(64));
    expect(res.status).toBe(401);
  });

  it("returns 500 (not 401) when a validly signed payload makes a handler throw", async () => {
    // valid signature, but installation.id is not a bigint -> the upsert throws
    const body = JSON.stringify({
      action: "created",
      installation: { id: "not-a-bigint", account: { login: "acme" } },
      repositories: [],
    });
    const { sign } = await import("@octokit/webhooks-methods");
    const res = await post(body, await sign("testsecret", body));
    expect(res.status).toBe(500);
  });
});
