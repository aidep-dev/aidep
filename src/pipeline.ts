import { matchesGlob } from "node:path";
import { gunzipSync } from "node:zlib";
import { DEFAULT_CONFIG, parseConfig } from "./config.ts";
import {
  createScan,
  finishScan,
  getRepo,
  recordFindings,
  setOnboardingPr,
  setRepoConfig,
  upsertRepo,
  type RepoRow,
} from "./db/index.ts";
import { buildOnboardingPr, openOnboardingPr } from "./github/onboarding.ts";
import { installationOctokit } from "./github/octokit.ts";
import type { RepoTarget } from "./github/types.ts";
import type { Job } from "./jobs.ts";
import { loadRegistry, type RegistryRow } from "./registry.ts";
import { scanFiles } from "./scanner/scan.ts";
import { untarToFiles } from "./scanner/tarball.ts";
import type { ScanResult } from "./scanner/types.ts";

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
      await onboardRepo(repoId);
      break;
    case "create_migration_pr":
    case "rerun_pr":
    case "ingest_eval_results":
      console.log("M3: not yet implemented", job.type);
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

export async function onboardRepo(repoId: number): Promise<void> {
  const existing = await getRepo(repoId);
  if (!existing) throw new Error(`onboard: repo ${repoId} not found`);
  if (existing.onboarding_pr_number !== null) {
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
  const prNumber = await openOnboardingPr(octokit, target, content);
  await setOnboardingPr(repoId, prNumber);
}
