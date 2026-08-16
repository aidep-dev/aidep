import { matchesGlob } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { DEFAULT_CONFIG, parseConfig, type AidepConfig } from "./config.ts";
import {
  createPrRecord,
  createScan,
  finishScan,
  getPrByNumber,
  getRepo,
  listOpenFindings,
  markFindingsPrOpen,
  recordFindings,
  setOnboardingPr,
  setPrEval,
  setRepoConfig,
  sql,
  upsertRepo,
  type FindingRow,
  type RepoRow,
} from "./db/index.ts";
import { anthropicLlm, extractCases } from "./evalgen/extract.ts";
import { generateEvalPack } from "./evalgen/pack.ts";
import type { GeneratedFile, Llm } from "./evalgen/types.ts";
import {
  ASSISTANTS_EVENT_ID,
  buildMigrationPr,
  ensureBranch,
  evalVerdict,
  judgeProviderFor,
  modelSlug,
  openMigrationPr,
  patchPrBody,
  putFilesOnBranch,
  renderEvalResults,
  replaceEvalSection,
  statusOf,
  type BuiltMigrationPr,
  type EvalResults,
} from "./github/migration.ts";
import { buildOnboardingPr, openOnboardingPr } from "./github/onboarding.ts";
import { installationOctokit } from "./github/octokit.ts";
import type { OctokitLike, RepoTarget } from "./github/types.ts";
import type { Job } from "./jobs.ts";
import { loadRegistry, type RegistryRow } from "./registry.ts";
import { scanFiles } from "./scanner/scan.ts";
import { untarToFiles } from "./scanner/tarball.ts";
import type { ScanResult } from "./scanner/types.ts";
import { transformForEvent } from "./transforms/index.ts";
import type { EventFileInput } from "./transforms/types.ts";

const CONFIG_PATH = ".github/aidep.json";

export async function runJob(job: Job): Promise<void> {
  const repoId = Number(job.payload.repoId);
  switch (job.type) {
    case "scan":
      await scanRepo(repoId, {
        rereadConfig: job.payload.rereadConfig === true,
        headSha: typeof job.payload.headSha === "string" ? job.payload.headSha : null,
      });
      break;
    case "onboard":
      await onboardRepo(repoId, { refresh: job.payload.refresh === true });
      break;
    case "create_migration_pr":
      await createMigrationPr(
        repoId,
        typeof job.payload.registryId === "string" ? job.payload.registryId : "",
      );
      break;
    case "rerun_pr":
      await rerunPr(repoId, Number(job.payload.prNumber));
      break;
    case "ingest_eval_results":
      await ingestEvalResults(repoId, typeof job.payload.branch === "string" ? job.payload.branch : "");
      break;
  }
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data as Uint8Array);
}

/** A glob ignores the path itself or anything beneath it: "docs" drops docs/x/y.md. */
function isIgnored(path: string, globs: string[]): boolean {
  return globs.some((g) => {
    const base = g.replace(/\/+$/, "");
    return matchesGlob(path, base) || matchesGlob(path, `${base}/**`);
  });
}

export interface ScanOutcome {
  repo: RepoRow;
  result: ScanResult;
  rows: RegistryRow[];
}

export async function scanRepo(
  repoId: number,
  opts: { rereadConfig?: boolean; headSha?: string | null } = {},
): Promise<ScanOutcome> {
  const repo = await getRepo(repoId);
  if (!repo) throw new Error(`scan: repo ${repoId} not found`);
  const octokit = await installationOctokit(repo.installation_id);

  // Installation payloads lack default_branch (we stored "main"); refresh it
  // from the API and persist when it changed.
  const meta = await octokit.request("GET /repos/{owner}/{repo}", {
    owner: repo.owner,
    repo: repo.name,
  });
  const defaultBranch = (meta.data as { default_branch: string }).default_branch;
  if (defaultBranch !== repo.default_branch) {
    await upsertRepo({
      id: repoId,
      installationId: repo.installation_id,
      owner: repo.owner,
      name: repo.name,
      defaultBranch,
    });
    repo.default_branch = defaultBranch;
  }

  let config = repo.config ?? DEFAULT_CONFIG;
  if (opts.rereadConfig) {
    // The triggering push touched .github/aidep.json: re-read and persist it.
    try {
      const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: repo.owner,
        repo: repo.name,
        path: CONFIG_PATH,
        ref: defaultBranch,
      });
      const raw = Buffer.from((res.data as { content: string }).content, "base64").toString("utf8");
      config = parseConfig(raw).config;
      await setRepoConfig(repoId, config);
      repo.config = config;
    } catch {
      // config unreadable (deleted?): keep the stored config
    }
  }

  const scanId = await createScan(repoId, opts.headSha ?? null);
  try {
    // tarball responses arrive gzipped; untarToFiles wants the raw tar
    const tar = await octokit.request("GET /repos/{owner}/{repo}/tarball/{ref}", {
      owner: repo.owner,
      repo: repo.name,
      ref: defaultBranch,
    });
    const files = untarToFiles(gunzipSync(toBuffer(tar.data)));
    const kept = files.filter((f) => !isIgnored(f.path, config.ignore));
    const rows = await loadRegistry();
    const result = scanFiles(kept, rows);
    await recordFindings(repoId, scanId, result.findings);
    await finishScan(scanId, "done", {
      filesScanned: result.filesScanned,
      filesSkipped: result.filesSkipped,
      findings: result.findings.length,
    });
    return { repo, result, rows };
  } catch (e) {
    await finishScan(scanId, "failed", null);
    throw e; // jobs layer retries
  }
}

export async function onboardRepo(repoId: number, opts: { refresh?: boolean } = {}): Promise<void> {
  const existing = await getRepo(repoId);
  if (!existing) throw new Error(`onboard: repo ${repoId} not found`);
  if (existing.onboarding_pr_number !== null && opts.refresh !== true) {
    // idempotent under job retries
    console.log(`onboard: repo ${repoId} already has PR #${existing.onboarding_pr_number}, skipping`);
    return;
  }
  const { repo, result, rows } = await scanRepo(repoId);
  const target: RepoTarget = {
    owner: repo.owner,
    name: repo.name,
    defaultBranch: repo.default_branch,
  };
  const content = buildOnboardingPr({
    repo: target,
    result,
    rows,
    now: new Date().toISOString().slice(0, 10),
  });
  const octokit = await installationOctokit(repo.installation_id);
  if (existing.onboarding_pr_number !== null) {
    // rebase-checkbox refresh: rescan happened above; just replace the body
    // (checkbox comes back unchecked because the template renders it unchecked)
    await patchPrBody(octokit, target, existing.onboarding_pr_number, content.body);
    return;
  }
  const prNumber = await openOnboardingPr(octokit, target, content);
  await setOnboardingPr(repoId, prNumber);
}

// ---------------------------------------------------------------------------
// migration PR jobs (create_migration_pr / rerun_pr / ingest_eval_results)

/**
 * Test seam for the eval-extraction llm. Production uses anthropicLlm (which
 * throws without ANTHROPIC_API_KEY; that throw becomes the skip reason);
 * tests inject a canned llm so nothing hits the network. Passing null restores
 * the production factory.
 */
let makeExtractionLlm: () => Llm = anthropicLlm;
export function setExtractionLlmForTesting(factory: (() => Llm) | null): void {
  makeExtractionLlm = factory ?? anthropicLlm;
}

interface PrRow {
  id: number;
  repo_id: number;
  number: number;
  deprecation_event: string;
  branch: string;
  eval_status: string;
}

function targetOf(repo: RepoRow): RepoTarget {
  return { owner: repo.owner, name: repo.name, defaultBranch: repo.default_branch };
}

/** Fetch each affected file off the default branch. Missing (404), oversize
 * (the contents API stops inlining content beyond 1MB), and binary files are
 * skipped; the transform only ever sees real utf8 sources. */
async function fetchEventFiles(
  octokit: OctokitLike,
  repo: RepoRow,
  paths: string[],
): Promise<EventFileInput[]> {
  const out: EventFileInput[] = [];
  for (const path of paths) {
    let data: { content?: string; encoding?: string };
    try {
      const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: repo.owner,
        repo: repo.name,
        path,
        ref: repo.default_branch,
      });
      data = res.data as typeof data;
    } catch (e) {
      if (statusOf(e) === 404) continue; // deleted since the scan
      throw e;
    }
    if (typeof data.content !== "string" || (data.encoding !== undefined && data.encoding !== "base64")) {
      continue;
    }
    const content = Buffer.from(data.content, "base64").toString("utf8");
    if (content.includes("\u0000")) continue; // binary
    out.push({ path, content });
  }
  return out;
}

/** promptfoo's canonical provider-id form per provider. */
function providerId(provider: RegistryRow["provider"], model: string): string {
  if (provider === "openai") return `openai:chat:${model}`;
  if (provider === "anthropic") return `anthropic:messages:${model}`;
  return `google:${model}`;
}

interface EvalPlan {
  pack: GeneratedFile[] | null;
  skipReason: string | null;
  pair: { old: string; new: string } | null;
  note: string | null;
}

const NO_EVAL: Omit<EvalPlan, "skipReason"> = { pack: null, pair: null, note: null };

/** The eval pack for one event, or the honest reason there is none. */
async function evalPackFor(
  event: RegistryRow,
  config: AidepConfig,
  files: EventFileInput[],
  rows: RegistryRow[],
): Promise<EvalPlan> {
  if (config.evals !== true) return { ...NO_EVAL, skipReason: null };

  // What the pack compares depends on the event:
  //  - model swap: old model vs replacement, same API
  //  - assistants rewrite: the same model via chat vs via the Responses API,
  //    so the eval exercises the new API path (the model is unchanged)
  let pair: { old: string; new: string };
  let modelPairLabel: { old: string; new: string };
  // shown in the PR body: provider ids only for the assistants case, where
  // chat-vs-responses IS the comparison; bare model ids read better for swaps
  let displayPair: { old: string; new: string } | null = null;
  if (event.id === ASSISTANTS_EVENT_ID) {
    const openaiModel = rows.find(
      (r) =>
        r.provider === "openai" &&
        r.surface === "model" &&
        r.api_ids.some((id) => files.some((f) => f.content.includes(id))),
    );
    const model =
      openaiModel?.api_ids.find((id) => files.some((f) => f.content.includes(id))) ?? null;
    if (model === null) {
      return {
        ...NO_EVAL,
        skipReason:
          "no OpenAI model id was found in the affected files to run the before/after comparison on; add cases to evals/ manually if wanted",
      };
    }
    pair = { old: providerId("openai", model), new: `openai:responses:${model}` };
    modelPairLabel = { old: model, new: model };
    displayPair = pair;
  } else if (event.surface === "model") {
    if (event.replacement_id === null) {
      return { ...NO_EVAL, skipReason: "no replacement model to run the comparison against" };
    }
    const oldModelId = event.api_ids[0];
    const newModelId = modelSlug(event.replacement_id);
    pair = {
      old: providerId(event.provider, oldModelId),
      new: providerId(event.provider, newModelId),
    };
    modelPairLabel = { old: oldModelId, new: newModelId };
  } else {
    return { ...NO_EVAL, skipReason: null };
  }

  let llm: Llm;
  try {
    llm = makeExtractionLlm();
  } catch {
    return { ...NO_EVAL, skipReason: "extraction key not configured" };
  }
  const cases = await extractCases(files, llm, { cap: 20 });
  if (cases.length === 0) {
    return { ...NO_EVAL, skipReason: "no eval cases could be extracted from the affected files" };
  }

  // promptfoo cross-products prompts × tests, so a pack is only clean with
  // one template: keep the largest template group and say what was dropped
  const byTemplate = new Map<string, typeof cases>();
  for (const c of cases) {
    const group = byTemplate.get(c.prompt) ?? [];
    group.push(c);
    byTemplate.set(c.prompt, group);
  }
  const kept = [...byTemplate.values()].sort((a, b) => b.length - a.length)[0];
  const dropped = cases.length - kept.length;

  return {
    pack: generateEvalPack({
      oldModelId: modelPairLabel.old,
      newModelId: modelPairLabel.new,
      oldProvider: pair.old,
      newProvider: pair.new,
      judgeProvider: judgeProviderFor(event.provider),
      cases: kept,
    }),
    skipReason: null,
    pair: displayPair,
    note:
      dropped === 0
        ? null
        : `${dropped} extracted case(s) using other prompt templates were left out to keep the eval matrix clean; add them to evals/tests.json manually if wanted.`,
  };
}

interface EventBuild {
  event: RegistryRow;
  built: BuiltMigrationPr;
  shippedEvalPack: boolean;
}

/** Shared by create and rerun: findings -> files -> transform -> eval -> body. */
async function buildMigrationForEvent(
  octokit: OctokitLike,
  repo: RepoRow,
  config: AidepConfig,
  registryId: string,
  statuses: Array<FindingRow["status"]>,
): Promise<EventBuild | null> {
  const rows = await loadRegistry();
  const event = rows.find((r) => r.id === registryId);
  if (event === undefined) {
    console.log(`migration: registry row ${registryId} not found, skipping`);
    return null;
  }
  const findings = (await listOpenFindings(repo.id)).filter(
    (f) => f.registry_id === registryId && statuses.includes(f.status),
  );
  // workflow files are report-only; aidep never edits .github/workflows
  const paths = [...new Set(findings.map((f) => f.path))].filter(
    (p) => !p.startsWith(".github/workflows/"),
  );
  if (paths.length === 0) {
    console.log(`migration: no ${statuses.join("/")} findings for ${registryId} on repo ${repo.id}, skipping`);
    return null;
  }
  const files = await fetchEventFiles(octokit, repo, paths);
  const result = transformForEvent(event, files, rows);
  const { pack, skipReason, pair, note } = await evalPackFor(event, config, files, rows);
  const built = buildMigrationPr({
    repo: targetOf(repo),
    event,
    result,
    evalPack: pack,
    evalSkipReason: skipReason,
    evalPair: pair,
    evalNote: note,
    now: new Date().toISOString().slice(0, 10),
  });
  return { event, built, shippedEvalPack: pack !== null };
}

export async function createMigrationPr(repoId: number, registryId: string): Promise<void> {
  if (!Number.isFinite(repoId) || registryId === "") {
    console.log("create_migration_pr: bad payload, skipping");
    return;
  }
  const repo = await getRepo(repoId);
  if (!repo) {
    console.log(`create_migration_pr: repo ${repoId} not found, skipping`);
    return;
  }
  const config = repo.config ?? DEFAULT_CONFIG;

  // prCap: open aidep migration PRs = distinct branches whose findings are
  // still pr_open. The job succeeds either way; the dashboard reflects the cap.
  const [{ n }] = await sql<{ n: number }[]>`
    select count(distinct p.branch)::int as n
    from prs p
    join findings f on f.pr_id = p.id
    where p.repo_id = ${repoId} and f.status = 'pr_open'`;
  if (n >= config.prCap) {
    console.log(`create_migration_pr: repo ${repoId} at prCap (${n}/${config.prCap}), skipping`);
    return;
  }

  const octokit = await installationOctokit(repo.installation_id);
  const build = await buildMigrationForEvent(octokit, repo, config, registryId, ["open"]);
  if (build === null) return;
  if (build.built.files.length === 0) {
    console.log(`create_migration_pr: nothing auto-migrated for ${registryId}, skipping`);
    return;
  }

  const prNumber = await openMigrationPr(octokit, targetOf(repo), build.built);
  // idempotent under retries: openMigrationPr returns the existing PR on 422
  const existing = (await getPrByNumber(repoId, prNumber)) as PrRow | null;
  const prId =
    existing !== null
      ? Number(existing.id)
      : await createPrRecord({
          repoId,
          number: prNumber,
          deprecationEvent: registryId,
          branch: build.built.branch,
          evalStatus: build.shippedEvalPack ? "pending" : "none",
        });
  await markFindingsPrOpen(repoId, registryId, prId);
}

export async function rerunPr(repoId: number, prNumber: number): Promise<void> {
  if (!Number.isFinite(repoId) || !Number.isFinite(prNumber)) {
    console.log("rerun_pr: bad payload, skipping");
    return;
  }
  const repo = await getRepo(repoId);
  if (!repo) {
    console.log(`rerun_pr: repo ${repoId} not found, skipping`);
    return;
  }
  const pr = (await getPrByNumber(repoId, prNumber)) as PrRow | null;
  if (pr === null) {
    console.log(`rerun_pr: PR #${prNumber} not tracked for repo ${repoId}, skipping`);
    return;
  }
  const config = repo.config ?? DEFAULT_CONFIG;
  const octokit = await installationOctokit(repo.installation_id);
  const build = await buildMigrationForEvent(octokit, repo, config, pr.deprecation_event, [
    "open",
    "pr_open",
  ]);
  if (build === null) return;
  const target = targetOf(repo);
  // the stored branch is the PR's head; recreate it off the current default
  // head only if it was deleted (422 otherwise), then refresh files + body.
  // putFilesOnBranch skips identical content, so re-runs stay idempotent.
  await ensureBranch(octokit, target, pr.branch);
  await putFilesOnBranch(octokit, target, pr.branch, build.built.files);
  await patchPrBody(octokit, target, pr.number, build.built.body);
}

/** Shape of evals/results.json, written by the customer's CI; hostile input. */
const EvalResultsSchema = z.object({
  judge: z.string().max(200),
  summary: z.object({
    held: z.number().int().min(0),
    drifted: z.number().int().min(0),
    inconclusive: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  cases: z
    .array(
      z.object({
        description: z.string().max(1000),
        verdict: z.string().max(100),
        details: z.string().max(1000).optional(),
      }),
    )
    .max(200),
});

export async function ingestEvalResults(repoId: number, branch: string): Promise<void> {
  if (!Number.isFinite(repoId) || branch === "") {
    console.log("ingest_eval_results: bad payload, skipping");
    return;
  }
  const repo = await getRepo(repoId);
  if (!repo) {
    console.log(`ingest_eval_results: repo ${repoId} not found, skipping`);
    return;
  }
  const prs = await sql<PrRow[]>`
    select * from prs where repo_id = ${repoId} and branch = ${branch}
    order by id desc limit 1`;
  const pr = prs[0];
  if (pr === undefined) {
    console.log(`ingest_eval_results: no PR tracked for ${branch} on repo ${repoId}, skipping`);
    return;
  }

  const octokit = await installationOctokit(repo.installation_id);
  let raw: string;
  try {
    const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: repo.owner,
      repo: repo.name,
      path: "evals/results.json",
      ref: branch,
    });
    const data = res.data as { content?: string };
    if (typeof data.content !== "string") return;
    raw = Buffer.from(data.content, "base64").toString("utf8");
  } catch (e) {
    if (statusOf(e) === 404) {
      console.log(`ingest_eval_results: evals/results.json missing on ${branch}, skipping`);
      return;
    }
    throw e;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log(`ingest_eval_results: results.json on ${branch} is not JSON, skipping`);
    return;
  }
  const check = EvalResultsSchema.safeParse(parsed);
  if (!check.success) {
    // malformed stays malformed on retry; log and finish the job
    console.log(`ingest_eval_results: results.json on ${branch} failed validation, skipping`);
    return;
  }
  const results: EvalResults = check.data;

  await setPrEval(repoId, pr.number, evalVerdict(results.summary), results.summary);

  const prRes = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner: repo.owner,
    repo: repo.name,
    pull_number: pr.number,
  });
  const body = (prRes.data as { body?: string | null }).body ?? "";
  const newBody = replaceEvalSection(body, renderEvalResults(results));
  if (newBody !== body) {
    await patchPrBody(octokit, targetOf(repo), pr.number, newBody);
  }
}
