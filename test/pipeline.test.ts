import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as tar from "tar";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { AidepConfigSchema, DEFAULT_CONFIG } from "../src/config.ts";
import { getRepo, markOnboarded, setRepoConfig, sql, upsertInstallation, upsertRepo } from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { buildOnboardingPr, openOnboardingPr } from "../src/github/onboarding.ts";
import { isIgnored, onboardRepo, runJob, scanRepo } from "../src/pipeline.ts";

// Recorder octokit behind the one seam both handlers and pipeline share.
const state = vi.hoisted(() => ({
  defaultBranch: "main",
  tarball: null as ArrayBuffer | null,
  configContent: null as string | null,
  /** status the contents GET fails with when configContent is null */
  configStatus: 404,
  requests: [] as Array<{ route: string; params: Record<string, unknown> }>,
}));

vi.mock("../src/github/octokit.ts", () => ({
  installationOctokit: vi.fn(async () => ({
    request: async (route: string, params: Record<string, unknown> = {}) => {
      state.requests.push({ route, params });
      if (route === "GET /repos/{owner}/{repo}") {
        return { data: { default_branch: state.defaultBranch } };
      }
      if (route === "GET /repos/{owner}/{repo}/tarball/{ref}") {
        return { data: state.tarball };
      }
      if (route === "GET /repos/{owner}/{repo}/contents/{path}") {
        if (state.configContent === null) {
          throw Object.assign(new Error(`${state.configStatus}`), { status: state.configStatus });
        }
        return { data: { content: Buffer.from(state.configContent).toString("base64") } };
      }
      throw new Error(`unexpected route ${route}`);
    },
  })),
}));

// Onboarding module is being implemented in parallel; mock its contract.
vi.mock("../src/github/onboarding.ts", () => ({
  buildOnboardingPr: vi.fn(() => ({
    branch: "aidep/configure",
    title: "Configure aidep",
    configPath: ".github/aidep.json",
    configContent: "{}",
    body: "onboarding",
  })),
  openOnboardingPr: vi.fn(async () => 77),
}));

// id ranges owned by this file (installation 3001, repos 31xx); other test
// files run in parallel against the same database.
const INST = 3001;

const workDir = mkdtempSync(join(tmpdir(), "aidep-pipeline-"));

/** GitHub-shaped gzipped tarball (single top-level dir) of the given files. */
async function tarballOf(files: Record<string, string>): Promise<ArrayBuffer> {
  const root = join(workDir, "repo");
  rmSync(root, { recursive: true, force: true });
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  const stream = tar.create({ gzip: true, cwd: workDir }, ["repo"]) as unknown as AsyncIterable<Buffer>;
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c);
  const buf = Buffer.concat(chunks);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const HIT = 'const model = "gpt-4-turbo";\n'; // one finding against the real registry

async function seedRepo(repoId: number): Promise<void> {
  await upsertInstallation(INST, "acme");
  await upsertRepo({ id: repoId, installationId: INST, owner: "acme", name: `r${repoId}`, defaultBranch: "main" });
}

function findingRows(repoId: number) {
  return sql<{ path: string; status: string; registry_id: string }[]>`
    select path, status, registry_id from findings where repo_id = ${repoId} order by path`;
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  rmSync(workDir, { recursive: true, force: true });
  await sql.end();
});

beforeEach(async () => {
  await sql`delete from installations where id between 3000 and 3999`;
  await sql`delete from jobs where (payload->>'repoId')::bigint between 3100 and 3199`;
  state.defaultBranch = "main";
  state.tarball = null;
  state.configContent = null;
  state.configStatus = 404;
  state.requests = [];
  vi.clearAllMocks();
});

it("scanRepo records findings and stats and refreshes the default branch", async () => {
  await seedRepo(3101);
  state.defaultBranch = "trunk";
  state.tarball = await tarballOf({ "src/a.ts": HIT, "src/b.ts": HIT });

  const { result } = await scanRepo(3101);

  expect(result.findings).toHaveLength(2);
  expect(result.findings.every((f) => f.registryId === "openai:model:gpt-4-turbo")).toBe(true);
  expect((await getRepo(3101))?.default_branch).toBe("trunk");
  const tarReq = state.requests.find((r) => r.route.includes("/tarball/"));
  expect(tarReq?.params.ref).toBe("trunk");

  const [scan] = await sql`select status, stats from scans where repo_id = 3101`;
  expect(scan.status).toBe("done");
  expect(scan.stats).toMatchObject({ filesScanned: 2, findings: 2 });
  expect(await findingRows(3101)).toEqual([
    { path: "src/a.ts", status: "open", registry_id: "openai:model:gpt-4-turbo" },
    { path: "src/b.ts", status: "open", registry_id: "openai:model:gpt-4-turbo" },
  ]);
});

it("rescan resolves findings that disappear and reopens ones that return", async () => {
  await seedRepo(3102);
  state.tarball = await tarballOf({ "src/a.ts": HIT, "src/b.ts": HIT });
  await scanRepo(3102);

  state.tarball = await tarballOf({ "src/a.ts": HIT });
  await scanRepo(3102);
  expect(await findingRows(3102)).toEqual([
    { path: "src/a.ts", status: "open", registry_id: "openai:model:gpt-4-turbo" },
    { path: "src/b.ts", status: "resolved", registry_id: "openai:model:gpt-4-turbo" },
  ]);

  state.tarball = await tarballOf({ "src/a.ts": HIT, "src/b.ts": HIT });
  await scanRepo(3102);
  expect((await findingRows(3102)).map((f) => f.status)).toEqual(["open", "open"]);
});

it("ignore globs drop exact files and whole directories", async () => {
  await seedRepo(3103);
  await markOnboarded(3103, AidepConfigSchema.parse({ ignore: ["docs", "src/b.ts"] }));
  state.tarball = await tarballOf({
    "src/a.ts": HIT,
    "src/b.ts": HIT,
    "docs/deep/x.md": HIT,
  });

  const { result } = await scanRepo(3103);
  expect(result.findings.map((f) => f.path)).toEqual(["src/a.ts"]);
});

it("ignore globs cover dotfiles beneath the directory, which shell ** does not", () => {
  // the two paths that leaked through test/** on our own repo, 2026-08-21
  const leaked = [
    "test/fixtures/fixture-repo/.env.example",
    "test/fixtures/fixture-repo/.github/workflows/nightly.yml",
  ];
  for (const path of leaked) {
    expect(isIgnored(path, ["test/**"]), path).toBe(true);
    expect(isIgnored(path, ["test"]), path).toBe(true);
  }
  // and the prefix test must not over-match a sibling that merely starts with the name
  expect(isIgnored("tests/a.ts", ["test/**"])).toBe(false);
  expect(isIgnored("testing.ts", ["test"])).toBe(false);
});

it("rereadConfig fetches, persists, and applies the pushed config", async () => {
  await seedRepo(3104);
  state.configContent = JSON.stringify({ ignore: ["src"] });
  state.tarball = await tarballOf({ "src/a.ts": HIT, "lib/b.ts": HIT });

  const { result } = await scanRepo(3104, { rereadConfig: true });

  expect(result.findings.map((f) => f.path)).toEqual(["lib/b.ts"]);
  expect((await getRepo(3104))?.config).toMatchObject({ ignore: ["src"], schedule: "daily" });
});

it("a reread that 404s puts the repo back on defaults", async () => {
  await seedRepo(3108);
  await setRepoConfig(3108, AidepConfigSchema.parse({ ignore: ["src"], evals: true }));
  state.tarball = await tarballOf({ "src/a.ts": HIT, "lib/b.ts": HIT });

  const { result } = await scanRepo(3108, { rereadConfig: true });

  expect(result.findings.map((f) => f.path).sort()).toEqual(["lib/b.ts", "src/a.ts"]);
  expect((await getRepo(3108))?.config).toEqual(DEFAULT_CONFIG);
});

it("a reread that fails for any other reason keeps the stored config", async () => {
  await seedRepo(3109);
  await setRepoConfig(3109, AidepConfigSchema.parse({ ignore: ["src"] }));
  state.configStatus = 503;
  state.tarball = await tarballOf({ "src/a.ts": HIT, "lib/b.ts": HIT });

  const { result } = await scanRepo(3109, { rereadConfig: true });

  expect(result.findings.map((f) => f.path)).toEqual(["lib/b.ts"]);
  expect((await getRepo(3109))?.config).toMatchObject({ ignore: ["src"] });
});

it("a failing scan is marked failed and rethrows for the jobs layer", async () => {
  await seedRepo(3105);
  state.tarball = new ArrayBuffer(16); // not gzip: gunzip throws

  await expect(scanRepo(3105)).rejects.toThrow();
  const [scan] = await sql`select status, stats from scans where repo_id = 3105`;
  expect(scan.status).toBe("failed");
  expect(scan.stats).toBeNull();
});

it("onboardRepo scans, opens the onboarding PR, and stores its number", async () => {
  await seedRepo(3106);
  state.tarball = await tarballOf({ "src/a.ts": HIT });

  await onboardRepo(3106);

  expect(buildOnboardingPr).toHaveBeenCalledWith(
    expect.objectContaining({
      repo: { owner: "acme", name: "r3106", defaultBranch: "main" },
      now: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
    }),
  );
  expect(vi.mocked(buildOnboardingPr).mock.calls[0][0].result.findings).toHaveLength(1);
  expect(openOnboardingPr).toHaveBeenCalledTimes(1);
  expect((await getRepo(3106))?.onboarding_pr_number).toBe(77);

  // idempotent under retries: a second run opens nothing
  await onboardRepo(3106);
  expect(openOnboardingPr).toHaveBeenCalledTimes(1);
});

it("runJob dispatches scan and onboard, no-ops the M3 job types", async () => {
  await seedRepo(3107);
  state.tarball = await tarballOf({ "src/a.ts": HIT });

  await runJob({ id: 1, type: "scan", payload: { repoId: 3107 }, attempts: 1 });
  expect(await findingRows(3107)).toHaveLength(1);

  await runJob({ id: 2, type: "create_migration_pr", payload: { repoId: 3107, registryId: "" }, attempts: 1 });
  await runJob({ id: 3, type: "rerun_pr", payload: { repoId: 3107, prNumber: 0 }, attempts: 1 });
  await runJob({ id: 4, type: "ingest_eval_results", payload: { repoId: 3107, prNumber: null, branch: "" }, attempts: 1 });
  // nothing scanned or created for the no-op types
  expect(await sql`select 1 from scans where repo_id = 3107`).toHaveLength(1);
});
