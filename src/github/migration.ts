/**
 * Migration PR builder + the octokit sequences that open and refresh one.
 * The body is assembled from transform output; every repo-derived fragment
 * that lands in a table or list we render here goes through mdEscape.
 * aidep never emits hosted prompt references; configs are inlined
 * (prompt creation is dashboard-only and /v1/prompts dies 2026-11-30).
 */

import { createHash } from "node:crypto";
import type { GeneratedFile } from "../evalgen/types.ts";
import type { RegistryRow } from "../registry.ts";
import { mdEscape } from "../scanner/report.ts";
import type { EventTransformResult } from "../transforms/types.ts";
import type { OctokitLike, RepoTarget } from "./types.ts";

export const ASSISTANTS_EVENT_ID = "openai:endpoint:assistants-api";

export interface MigrationPrInput {
  repo: RepoTarget;
  event: RegistryRow;
  result: EventTransformResult;
  evalPack: GeneratedFile[] | null;
  evalSkipReason: string | null;
  /** the two sides the pack actually compares (promptfoo provider ids);
   * defaults to old model id vs replacement when unset */
  evalPair?: { old: string; new: string } | null;
  /** extra one-line note under the eval block (e.g. dropped templates) */
  evalNote?: string | null;
  /** YYYY-MM-DD (same contract as the onboarding builder) */
  now: string;
}

export interface BuiltMigrationPr {
  branch: string;
  title: string;
  body: string;
  files: GeneratedFile[];
}

/** "anthropic:model:claude-sonnet-4-6" and bare "claude-sonnet-4-6" both
 * resolve to the model id (mirrors the report's slug()). */
export function modelSlug(id: string): string {
  const parts = id.split(":");
  return parts[parts.length - 1];
}

/** Judge pinned to a different family than the model under test, in
 * promptfoo's canonical provider-id form. */
export function judgeProviderFor(provider: RegistryRow["provider"]): string {
  return provider === "openai" ? "anthropic:messages:claude-sonnet-4-6" : "openai:chat:gpt-5.6-sol";
}

export function statusOf(e: unknown): number | undefined {
  return typeof e === "object" && e !== null && "status" in e
    ? (e as { status?: number }).status
    : undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-23" -> "Oct 23, 2026" without any timezone parsing. */
function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function branchFor(event: RegistryRow): string {
  // Prefix with provider + surface: the id tail alone can collide across
  // providers/surfaces (e.g. an openai:model:* and an anthropic:model:* that
  // share a slug), which would give two events the same branch and let prCap
  // and rerun target the wrong PR. The replace guards a future id from
  // producing a git-invalid ref (registry ids are already [a-z0-9.-]).
  const slug = `${event.provider}-${event.surface}-${modelSlug(event.id)}`
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-");
  return `aidep/${slug}`;
}

function titleFor(event: RegistryRow, result: EventTransformResult): string {
  if (event.id === ASSISTANTS_EVENT_ID) {
    const n = result.files.filter((f) => f.applied.length > 0).length;
    return `Migrate ${n} OpenAI Assistants API calls before the Aug 26 shutdown`;
  }
  if (event.surface === "param") return "Drop deprecated sampling params for Claude 4.7+";
  const old = event.api_ids[0];
  const next = event.replacement_id === null ? null : modelSlug(event.replacement_id);
  if (event.surface === "model" && next !== null) {
    if (event.status === "retired") return `Replace retired model ${old} with ${next}`;
    return event.dies === null
      ? `Replace ${old} with ${next}`
      : `Replace ${old} with ${next} before ${humanDate(event.dies)}`;
  }
  return event.dies === null ? `Migrate off ${old}` : `Migrate off ${old} before ${humanDate(event.dies)}`;
}

function summaryFor(event: RegistryRow, result: EventTransformResult): string {
  const n = result.files.filter((f) => f.migrated !== null).length;
  const files = `${n} ${n === 1 ? "file" : "files"}`;
  if (event.id === ASSISTANTS_EVENT_ID) {
    return `This PR moves ${files} off the OpenAI Assistants API, which shuts down ${event.dies ?? "2026-08-26"}, onto the Responses API (synchronous; no run polling; the text is on response.output_text).`;
  }
  if (event.surface === "param") {
    return `This PR removes non-default temperature/top_p/top_k arguments in ${files}; they return 400 on Claude Opus 4.7+ and newer models.`;
  }
  const old = event.api_ids[0];
  const next = event.replacement_id === null ? null : modelSlug(event.replacement_id);
  if (next === null) {
    return `This PR tracks ${old} usage; there is no announced replacement yet, see the checklist.`;
  }
  const dies =
    event.dies === null ? "" : event.status === "retired" ? ` (retired ${event.dies})` : ` (dies ${event.dies})`;
  return `This PR replaces ${old}${dies} with ${next} in ${files}.`;
}

export function buildMigrationPr(input: MigrationPrInput): BuiltMigrationPr {
  const { event, result, evalPack, evalSkipReason } = input;

  const files: GeneratedFile[] = [
    ...result.files.flatMap((f) => (f.migrated === null ? [] : [{ path: f.path, content: f.migrated }])),
    ...result.generatedFiles,
    ...(evalPack ?? []),
  ];

  const out: string[] = [summaryFor(event, result), ""];

  // (2) eval block at the top; pending pack, or the one-line skip reason
  if (evalPack !== null) {
    const old = input.evalPair?.old ?? event.api_ids[0];
    const next =
      input.evalPair?.new ??
      (event.replacement_id === null ? "the replacement model" : modelSlug(event.replacement_id));
    out.push(
      "## Eval",
      "",
      `**Eval: pending.** The evals/ pack in this PR runs your prompts on ${old} vs ${next} in your CI. Review evals/tests.json (these cases were extracted from your code), then move evals/workflows/aidep-eval.yml into .github/workflows/ to enable the run; moving the file is the opt-in.`,
      "",
      `Judge: ${judgeProviderFor(event.provider)} (a different model family than the one under test). Set its API key in repo secrets, or edit defaultTest.options.provider in evals/promptfooconfig.json to a family you hold keys for.`,
      "",
    );
    if (input.evalNote != null) out.push(`*${input.evalNote}*`, "");
  } else if (evalSkipReason !== null) {
    out.push("## Eval", "", `*Eval skipped: ${evalSkipReason}*`, "");
  }

  // (3) swap table; every repo-derived cell escaped
  const dies = event.dies ?? "no date";
  const rows: string[] = [];
  for (const f of result.files) {
    for (const s of f.swaps) {
      rows.push(`| ${mdEscape(f.path)} | ${mdEscape(`${s.old} → ${s.new}`)} | ${dies} |`);
    }
    for (const a of f.applied) {
      if (a.kind === "model-swap") continue; // the swaps rows above already carry these
      rows.push(`| ${mdEscape(f.path)} | ${mdEscape(a.description)} | ${dies} |`);
    }
  }
  out.push("## Changes", "");
  if (rows.length === 0) {
    out.push("No automatic changes; see the checklist.", "");
  } else {
    out.push("| file | change | dies |", "| --- | --- | --- |", ...rows, "");
  }

  // (4) deduped manual checklist (transforms own the escaping of their items)
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of [...result.files.flatMap((f) => f.checklist), ...result.eventChecklist]) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    items.push(`- [ ] ${item.text}`);
  }
  if (items.length > 0) out.push("## Manual checklist", "", ...items, "");

  // (5) provider links
  if (event.migration_url !== null) out.push(`Migration guide: ${event.migration_url}`);
  out.push(`Provider announcement: ${event.source_url}`, "");

  // (6) re-run checkbox
  out.push(
    "- [ ] <!-- aidep-rerun -->Check this box to have aidep re-run the migration on the current default branch.",
  );

  const pre = out.join("\n");
  const hash = createHash("sha256").update(pre, "utf8").digest("hex");

  return {
    branch: branchFor(event),
    title: titleFor(event, result),
    body: `${pre}\n<!-- aidep:body-hash:${hash} -->`,
    files,
  };
}

// ---------------------------------------------------------------------------
// eval-results rewrite (ingest_eval_results)

export interface EvalResults {
  judge: string;
  summary: { held: number; drifted: number; inconclusive: number; total: number };
  cases: Array<{ description: string; verdict: string; details?: string }>;
}

export function evalVerdict(s: EvalResults["summary"]): "held" | "drifted" | "inconclusive" {
  if (s.drifted > 0) return "drifted";
  if (s.inconclusive === s.total) return "inconclusive";
  return "held";
}

/** The "## Eval" section carrying CI results. Everything in results.json is
 * customer-CI-derived (hostile) and gets escaped. */
export function renderEvalResults(r: EvalResults): string {
  const verdict = evalVerdict(r.summary);
  const line =
    verdict === "drifted"
      ? `**Behavior drifted on ${r.summary.drifted}/${r.summary.total} prompts.**`
      : verdict === "inconclusive"
        ? `**Eval inconclusive: none of the ${r.summary.total} prompts produced a comparable result.**`
        : `**Behavior held on ${r.summary.held}/${r.summary.total} prompts.**`;
  const cases = r.cases.map(
    (c) => `- ${mdEscape(`${c.verdict}: ${c.description}${c.details ? ` (${c.details})` : ""}`)}`,
  );
  return [
    "## Eval",
    "",
    line,
    "",
    `Judge: ${mdEscape(r.judge)}.`,
    "",
    "<details>",
    "<summary>Per-case results</summary>",
    "",
    ...cases,
    "",
    "</details>",
    "",
    "",
  ].join("\n");
}

/** Swap the body's "## Eval" section (up to the next "## " heading) for
 * `section`, which must end with a blank line. Bodies without the marker get
 * the section appended (never dropped, so CI results are always recorded). */
export function replaceEvalSection(body: string, section: string): string {
  const start = body.indexOf("## Eval");
  if (start === -1) return body.endsWith("\n") ? body + section : `${body}\n${section}`;
  const next = body.indexOf("\n## ", start);
  if (next === -1) return body.slice(0, start) + section;
  return body.slice(0, start) + section + body.slice(next + 1);
}

// ---------------------------------------------------------------------------
// octokit sequences (same shapes as onboarding.ts)

/** Create `branch` off the default-branch head; 422 (already exists) is fine. */
export async function ensureBranch(octokit: OctokitLike, repo: RepoTarget, branch: string): Promise<void> {
  const base = { owner: repo.owner, repo: repo.name };
  const ref = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
    ...base,
    ref: `heads/${repo.defaultBranch}`,
  });
  const baseSha = (ref.data as { object: { sha: string } }).object.sha;
  try {
    await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      ...base,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
  } catch (e) {
    if (statusOf(e) !== 422) throw e;
  }
}

/**
 * PUT each file onto `branch`, sequentially (few files; stays far under rate
 * limits). Files already at the target content are skipped, which keeps job
 * retries and re-runs from stacking empty commits.
 */
export async function putFilesOnBranch(
  octokit: OctokitLike,
  repo: RepoTarget,
  branch: string,
  files: GeneratedFile[],
): Promise<void> {
  const base = { owner: repo.owner, repo: repo.name };
  for (const file of files) {
    let existingSha: string | undefined;
    try {
      const existing = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        ...base,
        path: file.path,
        ref: branch,
      });
      const data = existing.data as { sha?: string; content?: string };
      existingSha = data.sha;
      if (
        typeof data.content === "string" &&
        Buffer.from(data.content, "base64").toString("utf8") === file.content
      ) {
        continue;
      }
    } catch (e) {
      if (statusOf(e) !== 404) throw e;
    }
    await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
      ...base,
      path: file.path,
      message: `aidep: update ${file.path}`,
      content: Buffer.from(file.content, "utf8").toString("base64"),
      branch,
      ...(existingSha !== undefined ? { sha: existingSha } : {}),
    });
  }
}

export async function patchPrBody(
  octokit: OctokitLike,
  repo: RepoTarget,
  prNumber: number,
  body: string,
): Promise<void> {
  await octokit.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner: repo.owner,
    repo: repo.name,
    pull_number: prNumber,
    body,
  });
}

/**
 * Branch off the default head, commit the files, open the PR. When the PR
 * already exists (422), refresh its body and return its number.
 */
export async function openMigrationPr(
  octokit: OctokitLike,
  repo: RepoTarget,
  built: BuiltMigrationPr,
): Promise<number> {
  const base = { owner: repo.owner, repo: repo.name };
  await ensureBranch(octokit, repo, built.branch);
  await putFilesOnBranch(octokit, repo, built.branch, built.files);
  try {
    const pr = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
      ...base,
      title: built.title,
      head: built.branch,
      base: repo.defaultBranch,
      body: built.body,
    });
    return (pr.data as { number: number }).number;
  } catch (e) {
    // 422 "A pull request already exists"; find it, refresh its body
    if (statusOf(e) !== 422) throw e;
    const list = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
      ...base,
      head: `${repo.owner}:${built.branch}`,
      state: "open",
    });
    const prs = list.data as Array<{ number: number }>;
    if (prs.length === 0) throw e;
    await patchPrBody(octokit, repo, prs[0].number, built.body);
    return prs[0].number;
  }
}
