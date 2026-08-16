import { createHash, generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { App } from "octokit";
import postgres from "postgres";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cronGet } from "../app/api/cron/drain/route.ts";
import { loadRegistry } from "../src/registry.ts";
import { AidepConfigSchema, DEFAULT_CONFIG } from "../src/config.ts";
import {
  getRepo,
  markOnboarded,
  setInstallationSuspended,
  sql,
  upsertInstallation,
  upsertRepo,
} from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { setAppForTesting } from "../src/github/app.ts";
import { registerHandlers } from "../src/github/handlers.ts";
import { drain, enqueue } from "../src/jobs.ts";
import { runJob } from "../src/pipeline.ts";

vi.hoisted(() => {
  // Private database for this file. drain()/claimNext() claim from the whole
  // jobs table, so on the shared parallel-test database this file's real
  // drains would eat other files' queued jobs (and the webhook route's no-op
  // drain in handlers.test.ts would eat ours). Runs before any import, so
  // src/db/index.ts picks it up.
  process.env.DATABASE_URL = "postgres://postgres@localhost:5433/aidep_integration";
});

// Recorder octokit behind the one seam handlers + pipeline + onboarding share.
const state = vi.hoisted(() => ({
  tarball: null as Buffer | null,
  /** contents of .github/aidep.json once the onboarding flow PUT it */
  committedConfig: null as string | null,
  requests: [] as Array<{ route: string; params: Record<string, unknown> }>,
}));

vi.mock("../src/github/octokit.ts", () => ({
  installationOctokit: vi.fn(async () => ({
    request: async (route: string, params: Record<string, unknown> = {}) => {
      state.requests.push({ route, params });
      switch (route) {
        case "GET /repos/{owner}/{repo}":
          return { data: { default_branch: "main" } };
        case "GET /repos/{owner}/{repo}/tarball/{ref}":
          return { data: state.tarball };
        case "GET /repos/{owner}/{repo}/git/ref/{ref}":
          return { data: { object: { sha: "base-sha-40" } } };
        case "POST /repos/{owner}/{repo}/git/refs":
          return { data: {} };
        case "PUT /repos/{owner}/{repo}/contents/{path}":
          state.committedConfig = Buffer.from(params.content as string, "base64").toString("utf8");
          return { data: {} };
        case "POST /repos/{owner}/{repo}/pulls":
          return { data: { number: 7 } };
        case "GET /repos/{owner}/{repo}/contents/{path}":
          if (state.committedConfig === null) {
            throw Object.assign(new Error("Not Found"), { status: 404 });
          }
          return { data: { content: Buffer.from(state.committedConfig, "utf8").toString("base64") } };
        default:
          throw new Error(`unexpected route ${route}`);
      }
    },
  })),
}));

// id range owned by this file: 40xx (it also owns the aidep_integration
// database outright, but keep the convention visible).
const INST = 4001;
const INST_SUSPENDED = 4002;
const REPO = 4021;
const REPO_STALE = 4022;
const REPO_WEEKLY = 4023;
const REPO_SUSPENDED = 4024;

// Findings the fixture repo produces against the real ../aidep-registry.
const EXPECTED_IDS = [
  "anthropic:model:claude-3-5-sonnet-20241022",
  "anthropic:param:temperature-top-p-top-k",
  "google:model:gemini-2.0-flash-001",
  "openai:endpoint:assistants-api",
  "openai:model:gpt-4-turbo",
  "openai:model:gpt-5-2025-08-07",
];

let app: App;
let seq = 0;

function receive(name: string, payload: Record<string, unknown>): Promise<void> {
  return app.webhooks.receive({ id: `int-${seq++}`, name, payload } as never);
}

const inst = (id: number) => ({ id, account: { login: "acme" } });

function queuedScans(repoId: number) {
  return sql`
    select payload from jobs
    where type = 'scan' and status = 'queued' and (payload->>'repoId')::bigint = ${repoId}`;
}

function findingRows(repoId: number) {
  return sql<{ registry_id: string; status: string }[]>`
    select registry_id, status from findings where repo_id = ${repoId}`;
}

const reqs = (route: string) => state.requests.filter((r) => r.route === route);

beforeAll(async () => {
  const admin = postgres("postgres://postgres@localhost:5433/aidep", { onnotice: () => {} });
  try {
    await admin.unsafe("create database aidep_integration");
  } catch {
    // already exists (or postgres is down, which migrate() reports clearly)
  }
  await admin.end();
  await migrate();

  // throwaway key generated per run; nothing secret is stored
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  app = new App({ appId: 999002, privateKey: pem, webhooks: { secret: "testsecret" } });
  registerHandlers(app);
  setAppForTesting(app);

  // GitHub-shaped gzipped tarball (single top-level dir) of the fixture repo
  const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
  const stream = tar.create({ gzip: true, cwd: fixturesDir }, ["fixture-repo"]) as unknown as AsyncIterable<Buffer>;
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c);
  state.tarball = Buffer.concat(chunks);
});

afterAll(async () => {
  setAppForTesting(null);
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate installations, repos, scans, findings, prs, jobs restart identity cascade`;
  state.committedConfig = null;
  state.requests = [];
});

it("install → onboarding PR → merge → push rescan, end to end", async () => {
  // --- installation.created enqueues an onboard job ---
  await receive("installation", {
    action: "created",
    installation: inst(INST),
    repositories: [{ id: REPO, name: "fixture", full_name: "acme/fixture" }],
  });
  const queued = await sql`
    select 1 from jobs
    where type = 'onboard' and status = 'queued' and (payload->>'repoId')::bigint = ${REPO}`;
  expect(queued).toHaveLength(1);

  // --- drain runs the onboard job: scan + onboarding PR ---
  expect(await drain(runJob)).toEqual({ ran: 1, failed: 0 });

  const [refRead] = reqs("GET /repos/{owner}/{repo}/git/ref/{ref}");
  expect(refRead.params).toMatchObject({ owner: "acme", repo: "fixture", ref: "heads/main" });
  const [branchCreate] = reqs("POST /repos/{owner}/{repo}/git/refs");
  expect(branchCreate.params).toMatchObject({ ref: "refs/heads/aidep/configure", sha: "base-sha-40" });

  const [configPut] = reqs("PUT /repos/{owner}/{repo}/contents/{path}");
  expect(configPut.params.path).toBe(".github/aidep.json");
  const putJson = Buffer.from(configPut.params.content as string, "base64").toString("utf8");
  expect(JSON.parse(putJson)).toEqual(DEFAULT_CONFIG);

  const [prPost] = reqs("POST /repos/{owner}/{repo}/pulls");
  expect(prPost.params).toMatchObject({ title: "Configure aidep", head: "aidep/configure", base: "main" });
  const body = prPost.params.body as string;
  expect(body).toContain("Welcome to aidep");
  // audit sections from the real registry, with the countdown rendered
  expect(body).toContain("## assistants-api (openai)");
  expect(body).toContain("## claude-3-5-sonnet-20241022 (anthropic)");
  expect(body).toMatch(/\(-?\d+ days\)/);
  // rebase checkbox and config explanation
  expect(body).toContain("- [ ] <!-- aidep-rebase -->");
  expect(body).toContain("This PR adds `.github/aidep.json`:");
  expect(body).toContain('- `schedule`: "daily" or "weekly" scan cadence.');

  expect((await getRepo(REPO))?.onboarding_pr_number).toBe(7);
  const scans1 = await sql`select status, stats from scans where repo_id = ${REPO}`;
  expect(scans1).toHaveLength(1);
  const findings1 = await findingRows(REPO);
  expect(findings1.length).toBeGreaterThan(0);
  expect(scans1[0]).toMatchObject({
    status: "done",
    stats: { filesScanned: 9, filesSkipped: 1, findings: findings1.length },
  });
  expect([...new Set(findings1.map((f) => f.registry_id))].sort()).toEqual(EXPECTED_IDS);
  expect(findings1.every((f) => f.status === "open")).toBe(true);

  // --- merging the configure PR onboards the repo and stores the config ---
  await receive("pull_request", {
    action: "closed",
    number: 7,
    installation: inst(INST),
    repository: { id: REPO },
    pull_request: { number: 7, merged: true, body: "", head: { ref: "aidep/configure" } },
  });
  const repo = await getRepo(REPO);
  expect(repo?.onboarded_at).not.toBeNull();
  expect(repo?.config).toEqual(DEFAULT_CONFIG);

  // --- default-branch pushes enqueue exactly one scan job ---
  const push = () =>
    receive("push", {
      ref: "refs/heads/main",
      repository: { id: REPO },
      installation: inst(INST),
      commits: [{ added: [], modified: ["src/summarize.ts"], removed: [] }],
    });
  await push();
  await push();
  expect(await queuedScans(REPO)).toHaveLength(1);

  // --- rescan completes; findings stable: same count, none resolved ---
  expect(await drain(runJob)).toEqual({ ran: 1, failed: 0 });
  const scans2 = await sql`select status from scans where repo_id = ${REPO} order by id`;
  expect(scans2.map((s) => s.status)).toEqual(["done", "done"]);
  const findings2 = await findingRows(REPO);
  expect(findings2).toHaveLength(findings1.length);
  expect(findings2.every((f) => f.status === "open")).toBe(true);
});

describe("cron drain route", () => {
  const get = (auth?: string) =>
    cronGet(new Request("http://localhost/api/cron/drain", { headers: auth ? { authorization: auth } : {} }));

  beforeEach(async () => {
    process.env.CRON_SECRET = "cron-secret-40";
    // Pin the stored registry hash to the current registry so the
    // registry-change trigger is deterministically quiet in these tests
    // (meta survives the table truncation above on purpose).
    const rows = await loadRegistry();
    const hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    await sql`
      insert into meta (key, value) values ('registry_hash', ${hash})
      on conflict (key) do update set value = ${hash}`;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects missing or wrong bearer, and everything when the secret is unset outside development", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("Bearer wrong")).status).toBe(401);
    delete process.env.CRON_SECRET;
    // NODE_ENV is "test" under vitest, so the unset-secret dev allowance does not apply
    expect((await get("Bearer cron-secret-40")).status).toBe(401);
  });

  it("enqueues rescans for stale repos only, then drains them", async () => {
    await upsertInstallation(INST, "acme");
    await upsertRepo({ id: REPO_STALE, installationId: INST, owner: "acme", name: "stale", defaultBranch: "main" });
    await markOnboarded(REPO_STALE, DEFAULT_CONFIG); // daily
    await upsertRepo({ id: REPO_WEEKLY, installationId: INST, owner: "acme", name: "weekly", defaultBranch: "main" });
    await markOnboarded(REPO_WEEKLY, AidepConfigSchema.parse({ schedule: "weekly" }));
    await upsertInstallation(INST_SUSPENDED, "dormant");
    await setInstallationSuspended(INST_SUSPENDED, true);
    await upsertRepo({ id: REPO_SUSPENDED, installationId: INST_SUSPENDED, owner: "dormant", name: "s", defaultBranch: "main" });
    await markOnboarded(REPO_SUSPENDED, DEFAULT_CONFIG);
    await sql`
      insert into scans (repo_id, status, finished_at) values
        (${REPO_STALE}, 'done', now() - interval '25 hours'),
        (${REPO_WEEKLY}, 'done', now() - interval '2 days'),
        (${REPO_SUSPENDED}, 'done', now() - interval '25 hours')`;

    const res = await get("Bearer cron-secret-40");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enqueued: 1, registryTriggered: 0, ran: 1, failed: 0 });

    // the one job was for the stale daily repo and the drain ran it
    const jobs = await sql<{ payload: { repoId: number }; status: string }[]>`
      select payload, status from jobs where type = 'scan'`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("done");
    expect(Number(jobs[0].payload.repoId)).toBe(REPO_STALE);
    const scans = await sql`select 1 from scans where repo_id = ${REPO_STALE} and status = 'done'`;
    expect(scans).toHaveLength(2);

    // freshly scanned: a second call enqueues nothing
    const res2 = await get("Bearer cron-secret-40");
    expect(await res2.json()).toEqual({ enqueued: 0, registryTriggered: 0, ran: 0, failed: 0 });
  });

  it("registry change triggers rescans for all onboarded repos", async () => {
    await upsertInstallation(INST, "acme");
    await upsertRepo({ id: REPO_STALE, installationId: INST, owner: "acme", name: "stale", defaultBranch: "main" });
    await markOnboarded(REPO_STALE, DEFAULT_CONFIG);
    // freshly scanned, so the schedule-based path stays quiet
    await sql`insert into scans (repo_id, status, finished_at) values (${REPO_STALE}, 'done', now())`;
    await sql`update meta set value = 'stale-hash' where key = 'registry_hash'`;

    const res = await get("Bearer cron-secret-40");
    const body = await res.json();
    expect(body.enqueued).toBe(0);
    expect(body.registryTriggered).toBe(1);
    expect(body.ran).toBe(1);

    // hash settled: the next call is quiet again
    const res2 = await get("Bearer cron-secret-40");
    expect(await res2.json()).toEqual({ enqueued: 0, registryTriggered: 0, ran: 0, failed: 0 });
  });

  it("does not double-enqueue when a scan job is already queued", async () => {
    await upsertInstallation(INST, "acme");
    await upsertRepo({ id: REPO_STALE, installationId: INST, owner: "acme", name: "stale", defaultBranch: "main" });
    await markOnboarded(REPO_STALE, DEFAULT_CONFIG);
    await sql`insert into scans (repo_id, status, finished_at) values (${REPO_STALE}, 'done', now() - interval '25 hours')`;
    await enqueue("scan", { repoId: REPO_STALE });

    const res = await get("Bearer cron-secret-40");
    // enqueued nothing new; the drain ran the pre-existing queued job
    expect(await res.json()).toEqual({ enqueued: 0, registryTriggered: 0, ran: 1, failed: 0 });
  });
});
