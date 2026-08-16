import type { App } from "octokit";
import { DEFAULT_CONFIG, parseConfig } from "../config.ts";
import {
  deleteInstallation,
  getRepo,
  markOnboarded,
  setInstallationSuspended,
  sql,
  upsertInstallation,
  upsertRepo,
} from "../db/index.ts";
import { enqueue } from "../jobs.ts";
import { installationOctokit } from "./octokit.ts";

const CONFIGURE_BRANCH = "aidep/configure";
const CONFIG_PATH = ".github/aidep.json";
// onboarding PR body uses aidep-rebase; migration PR bodies use aidep-rerun
const REBASE_CHECKED = "- [x] <!-- aidep-rebase -->";
const RERUN_CHECKED = "- [x] <!-- aidep-rerun -->";

const REGISTERED = Symbol.for("aidep.handlersRegistered");

function accountLogin(account: unknown): string {
  // installation.account is a user (login) or an enterprise (slug)
  const a = account as { login?: string; slug?: string } | null;
  return a?.login ?? a?.slug ?? "unknown";
}

async function addRepos(
  installationId: number,
  repos: Array<{ id: number; full_name: string }>,
): Promise<void> {
  for (const r of repos) {
    const [owner, name] = r.full_name.split("/");
    // The installation payload's repositories[] lacks default_branch; store
    // "main" and let the scan job correct it via GET /repos/{owner}/{repo}.
    await upsertRepo({ id: r.id, installationId, owner, name, defaultBranch: "main" });
    await enqueue("onboard", { installationId, repoId: r.id });
  }
}

/**
 * Wire all webhook handlers onto the App. Idempotent per App instance (guarded
 * by a symbol on the object), so the route can call it on every request and
 * survive hot reloads without double-registering.
 *
 * Handlers stay fast: they only write DB rows and enqueue jobs. Slow work
 * (tarball scans, PR creation) runs in drain() after the response.
 */
export function registerHandlers(app: App): void {
  const flags = app as unknown as Record<symbol, boolean | undefined>;
  if (flags[REGISTERED]) return;
  flags[REGISTERED] = true;

  app.webhooks.on("installation.created", async ({ payload }) => {
    await upsertInstallation(payload.installation.id, accountLogin(payload.installation.account));
    await addRepos(payload.installation.id, payload.repositories ?? []);
  });

  app.webhooks.on("installation_repositories.added", async ({ payload }) => {
    await upsertInstallation(payload.installation.id, accountLogin(payload.installation.account));
    await addRepos(payload.installation.id, payload.repositories_added);
  });

  app.webhooks.on("installation_repositories.removed", async ({ payload }) => {
    for (const r of payload.repositories_removed) {
      // db/index.ts is a frozen contract with no deleteRepo helper; inline the
      // delete here. scans/findings/prs cascade via FK.
      await sql`delete from repos where id = ${r.id}`;
    }
  });

  app.webhooks.on("installation.deleted", async ({ payload }) => {
    await deleteInstallation(payload.installation.id);
  });

  app.webhooks.on("installation.suspend", async ({ payload }) => {
    await setInstallationSuspended(payload.installation.id, true);
  });

  app.webhooks.on("installation.unsuspend", async ({ payload }) => {
    await setInstallationSuspended(payload.installation.id, false);
  });

  app.webhooks.on("push", async ({ payload }) => {
    const repoId = payload.repository.id;
    const repo = await getRepo(repoId);
    if (!repo) return;
    const touched = (p: string) =>
      payload.commits.some((c) => (c.added ?? []).includes(p) || (c.modified ?? []).includes(p));

    if (payload.ref === `refs/heads/${repo.default_branch}`) {
      // not onboarded (onboarding PR still open, or closed unmerged): disabled
      if (repo.onboarded_at === null) return;
      // debounce: at most one pending scan per repo (queued or mid-run)
      const queued = await sql`
        select 1 from jobs
        where type = 'scan' and status in ('queued', 'running')
          and (payload->>'repoId')::bigint = ${repoId}
        limit 1`;
      if (queued.length > 0) return;
      await enqueue("scan", { repoId, headSha: payload.after, rereadConfig: touched(CONFIG_PATH) });
      return;
    }

    const branch = payload.ref.replace(/^refs\/heads\//, "");
    if (branch.startsWith("aidep/") && touched("evals/results.json")) {
      await enqueue("ingest_eval_results", { repoId, prNumber: null, branch });
    }
  });

  app.webhooks.on("pull_request.closed", async ({ payload }) => {
    const repo = await getRepo(payload.repository.id);
    if (!repo || payload.number !== repo.onboarding_pr_number) return;
    if (!payload.pull_request.merged) {
      // Onboarding PR closed without merging: onboarded_at stays null and the
      // repo stays disabled (default-branch pushes never enqueue scans).
      return;
    }
    // Merged configure PR: read the committed config off the default branch
    // and flip the repo to onboarded. Fast enough to do inline. A missing or
    // renamed config file must not block onboarding: fall back to defaults.
    let config = DEFAULT_CONFIG;
    try {
      const octokit = await installationOctokit(repo.installation_id);
      const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: repo.owner,
        repo: repo.name,
        path: CONFIG_PATH,
        ref: repo.default_branch,
      });
      const raw = Buffer.from((res.data as { content: string }).content, "base64").toString("utf8");
      config = parseConfig(raw).config;
    } catch {
      // keep defaults
    }
    await markOnboarded(payload.repository.id, config);
  });

  app.webhooks.on("pull_request.edited", async ({ payload }) => {
    const head = payload.pull_request.head.ref;
    if (!head.startsWith("aidep/")) return;
    const flipped = (marker: string) =>
      (payload.pull_request.body ?? "").includes(marker) &&
      !(payload.changes.body?.from ?? "").includes(marker);
    if (head === CONFIGURE_BRANCH) {
      // onboarding PR: refresh the scan + body in place
      if (flipped(REBASE_CHECKED)) {
        await enqueue("onboard", { repoId: payload.repository.id, refresh: true });
      }
      return;
    }
    if (flipped(RERUN_CHECKED)) {
      await enqueue("rerun_pr", { repoId: payload.repository.id, prNumber: payload.number });
    }
  });
}
