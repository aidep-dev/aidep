import { createHash } from "node:crypto";
import { DEFAULT_CONFIG } from "../config.ts";
import type { RegistryRow } from "../registry.ts";
import type { ScanResult } from "../scanner/types.ts";
import { renderMarkdownReport } from "../scanner/report.ts";
import { statusOf } from "./migration.ts";
import type { OctokitLike, RepoTarget } from "./types.ts";

export interface OnboardingPrContent {
  /** always "aidep/configure" */
  branch: string;
  /** always "Configure aidep" */
  title: string;
  /** always ".github/aidep.json" */
  configPath: string;
  configContent: string;
  body: string;
}

export interface OnboardInput {
  repo: RepoTarget;
  result: ScanResult;
  rows: RegistryRow[];
  /** YYYY-MM-DD, for countdown rendering */
  now: string;
}

export function buildOnboardingPr(input: OnboardInput): OnboardingPrContent {
  const appUrl = process.env.APP_URL ?? "https://aidep.example";

  const found =
    input.result.findings.length === 0
      ? "No exposures today. aidep keeps watching: the registry updates as providers announce retirements."
      : renderMarkdownReport(input.result, { now: input.now, header: false }).trimEnd();

  const pre = [
    "Welcome to aidep! This PR sets up deprecation monitoring for your AI provider dependencies. aidep does nothing else until you merge it.",
    "",
    "Merge this PR to activate aidep. Close it unmerged to disable aidep on this repo.",
    "",
    "## What we found",
    "",
    found,
    "",
    "## What happens after you merge",
    "",
    "- aidep scans on every push to the default branch and whenever the deprecation registry changes.",
    "- Findings appear on your dashboard.",
    "- Migration PRs are opt-in per finding from the dashboard. aidep never opens a migration PR you did not request.",
    "- The config file in this PR controls everything.",
    "",
    "## Config",
    "",
    "This PR adds `.github/aidep.json`:",
    "",
    '- `schedule`: "daily" or "weekly" scan cadence.',
    "- `ignore`: glob patterns for paths aidep skips.",
    "- `prCap`: max open aidep migration PRs at once (default 5). Retirements within 30 days ignore it.",
    "- `evals`: false by default. When true, migration PRs additionally ship an evals/ pack + a GitHub Actions workflow file that runs your prompts on old vs new model in YOUR CI with YOUR keys; you review the extracted test cases in the PR before anything runs. Drafting those cases sends the affected files to Anthropic once each, using our key; leave `evals` off and your code never leaves the scan.",
    "",
    `Questions? ${appUrl}/docs`,
    "",
    "- [ ] <!-- aidep-rebase -->If you want aidep to re-run the scan and refresh this PR, check this box.",
  ].join("\n");

  const hash = createHash("sha256").update(pre, "utf8").digest("hex");

  return {
    branch: "aidep/configure",
    title: "Configure aidep",
    configPath: ".github/aidep.json",
    configContent: JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
    body: `${pre}\n<!-- aidep:body-hash:${hash} -->`,
  };
}

/**
 * Create the onboarding branch off the default branch head, commit the config
 * file, open the PR. Returns the PR number.
 */
export async function openOnboardingPr(
  octokit: OctokitLike,
  repo: RepoTarget,
  content: OnboardingPrContent,
): Promise<number> {
  const base = { owner: repo.owner, repo: repo.name };

  const ref = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
    ...base,
    ref: `heads/${repo.defaultBranch}`,
  });
  const baseSha = (ref.data as { object: { sha: string } }).object.sha;

  try {
    await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      ...base,
      ref: `refs/heads/${content.branch}`,
      sha: baseSha,
    });
  } catch (e) {
    // 422: branch already exists (a previous run got this far); reuse it
    if (statusOf(e) !== 422) throw e;
  }

  let existingFileSha: string | undefined;
  try {
    const existing = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      ...base,
      path: content.configPath,
      ref: content.branch,
    });
    existingFileSha = (existing.data as { sha?: string }).sha;
  } catch (e) {
    if (statusOf(e) !== 404) throw e;
  }

  const params = {
    ...base,
    path: content.configPath,
    message: "Add aidep config",
    content: Buffer.from(content.configContent, "utf8").toString("base64"),
    branch: content.branch,
  };
  // sha present means update an existing file, absent means create it.
  await octokit.request(
    "PUT /repos/{owner}/{repo}/contents/{path}",
    existingFileSha === undefined ? params : { ...params, sha: existingFileSha },
  );

  try {
    const pr = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
      ...base,
      title: content.title,
      head: content.branch,
      base: repo.defaultBranch,
      body: content.body,
    });
    return (pr.data as { number: number }).number;
  } catch (e) {
    // 422 "A pull request already exists"; find and return it
    if (statusOf(e) !== 422) throw e;
    const list = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
      ...base,
      head: `${repo.owner}:${content.branch}`,
      state: "open",
    });
    const prs = list.data as Array<{ number: number }>;
    if (prs.length === 0) throw e;
    return prs[0].number;
  }
}
