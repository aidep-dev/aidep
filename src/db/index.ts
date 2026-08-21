import postgres from "postgres";
import type { Finding } from "../scanner/types.ts";
import type { AidepConfig } from "../config.ts";

export const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/aidep",
  { onnotice: () => {} },
);

// ---- installations ----

export async function upsertInstallation(id: number, accountLogin: string): Promise<void> {
  // Do NOT touch suspended_at here: a plain re-install or webhook redelivery
  // would otherwise silently un-suspend a suspended install. Only the
  // installation.unsuspend event clears it, via setInstallationSuspended.
  await sql`
    insert into installations (id, account_login) values (${id}, ${accountLogin})
    on conflict (id) do update set account_login = ${accountLogin}`;
}

export async function setInstallationSuspended(id: number, suspended: boolean): Promise<void> {
  await sql`update installations set suspended_at = ${suspended ? sql`now()` : null} where id = ${id}`;
}

/** installation-deleted purge: cascades to repos, scans, findings, prs. */
export async function deleteInstallation(id: number): Promise<void> {
  // jobs have no FK to repos (payload carries repoId), so the cascade below
  // would leave orphan queued jobs that retry 5x against a deleted repo.
  // Delete them first, while the repo rows still exist to identify them.
  await sql`
    delete from jobs
    where (payload->>'repoId')::bigint in (select id from repos where installation_id = ${id})`;
  await sql`delete from installations where id = ${id}`;
}

// ---- repos ----

export interface RepoRow {
  id: number;
  installation_id: number;
  owner: string;
  name: string;
  default_branch: string;
  private: boolean;
  config: AidepConfig | null;
  onboarding_pr_number: number | null;
  onboarded_at: string | null;
}

export async function upsertRepo(r: {
  id: number;
  installationId: number;
  owner: string;
  name: string;
  defaultBranch: string;
  private?: boolean;
}): Promise<void> {
  const isPrivate = r.private ?? false;
  await sql`
    insert into repos (id, installation_id, owner, name, default_branch, private)
    values (${r.id}, ${r.installationId}, ${r.owner}, ${r.name}, ${r.defaultBranch}, ${isPrivate})
    on conflict (id) do update set
      installation_id = ${r.installationId}, owner = ${r.owner},
      name = ${r.name}, default_branch = ${r.defaultBranch}, private = ${isPrivate}`;
}

export async function getRepo(id: number): Promise<RepoRow | null> {
  const rows = await sql<RepoRow[]>`select * from repos where id = ${id}`;
  return rows[0] ?? null;
}

export async function getRepoByFullName(owner: string, name: string): Promise<RepoRow | null> {
  const rows = await sql<RepoRow[]>`select * from repos where owner = ${owner} and name = ${name}`;
  return rows[0] ?? null;
}

export async function setOnboardingPr(repoId: number, prNumber: number): Promise<void> {
  await sql`update repos set onboarding_pr_number = ${prNumber} where id = ${repoId}`;
}

export async function markOnboarded(repoId: number, config: AidepConfig): Promise<void> {
  await sql`update repos set onboarded_at = now(), config = ${sql.json(config)} where id = ${repoId}`;
}

export async function setRepoConfig(repoId: number, config: AidepConfig): Promise<void> {
  await sql`update repos set config = ${sql.json(config)} where id = ${repoId}`;
}

// ---- scans ----

export async function createScan(repoId: number, headSha: string | null): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into scans (repo_id, head_sha) values (${repoId}, ${headSha}) returning id`;
  return rows[0].id;
}

export async function finishScan(
  scanId: number,
  status: "done" | "failed",
  stats: { filesScanned: number; filesSkipped: number; findings: number } | null,
): Promise<void> {
  await sql`
    update scans set status = ${status}, stats = ${stats ? sql.json(stats) : null},
      finished_at = now() where id = ${scanId}`;
}

// ---- findings ----

export interface FindingRow {
  id: number;
  repo_id: number;
  registry_id: string;
  surface: string;
  path: string;
  line: number;
  matched: string;
  replacement_id: string | null;
  dies: string | null;
  dies_is_earliest: boolean;
  status: "open" | "pr_open" | "resolved" | "ignored";
  pr_id: number | null;
}

/**
 * Bulk upsert this scan's findings, then resolve open findings the scan no
 * longer saw. Re-appearing resolved findings reopen.
 */
export async function recordFindings(
  repoId: number,
  scanId: number,
  findings: Finding[],
): Promise<void> {
  for (const f of findings) {
    await sql`
      insert into findings
        (repo_id, scan_id, registry_id, surface, path, line, matched,
         replacement_id, dies, dies_is_earliest)
      values
        (${repoId}, ${scanId}, ${f.registryId}, ${f.surface}, ${f.path}, ${f.line},
         ${f.matched}, ${f.replacementId}, ${f.dies}, ${f.diesIsEarliestPossible})
      on conflict (repo_id, registry_id, path, line, matched) do update set
        scan_id = ${scanId}, last_seen = now(),
        replacement_id = ${f.replacementId}, dies = ${f.dies},
        dies_is_earliest = ${f.diesIsEarliestPossible},
        status = case when findings.status = 'resolved' then 'open' else findings.status end`;
  }
  // pr_open findings resolve too once the fix lands (merged PR → rescan no
  // longer sees them); otherwise they would stay pr_open forever
  await sql`
    update findings set status = 'resolved'
    where repo_id = ${repoId} and status in ('open', 'pr_open')
      and scan_id is distinct from ${scanId}`;
}

export async function listOpenFindings(repoId: number): Promise<FindingRow[]> {
  return sql<FindingRow[]>`
    select * from findings
    where repo_id = ${repoId} and status in ('open', 'pr_open')
    order by dies asc nulls last, path, line`;
}

/**
 * Distinct open aidep migration branches. This is what prCap counts, and both
 * the migrate route (before enqueueing) and the job (before building) ask it,
 * so the answer has to come from one place.
 */
export async function countOpenMigrationPrs(repoId: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(distinct p.branch)::int as n
    from prs p
    join findings f on f.pr_id = p.id
    where p.repo_id = ${repoId} and f.status = 'pr_open'`;
  return row?.n ?? 0;
}

export async function markFindingsPrOpen(repoId: number, registryId: string, prId: number): Promise<void> {
  // workflow-file findings stay open: the PR deliberately never edits
  // .github/workflows, so those exposures are not addressed by it
  await sql`
    update findings set status = 'pr_open', pr_id = ${prId}
    where repo_id = ${repoId} and registry_id = ${registryId} and status = 'open'
      and path not like '.github/workflows/%'`;
}

// ---- prs ----

export async function createPrRecord(r: {
  repoId: number;
  number: number;
  deprecationEvent: string;
  branch: string;
  evalStatus?: string;
}): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into prs (repo_id, number, deprecation_event, branch, eval_status)
    values (${r.repoId}, ${r.number}, ${r.deprecationEvent}, ${r.branch}, ${r.evalStatus ?? "none"})
    returning id`;
  return rows[0].id;
}

export async function getPrByNumber(repoId: number, number: number) {
  const rows = await sql`select * from prs where repo_id = ${repoId} and number = ${number}`;
  return rows[0] ?? null;
}

/** Eval counts persisted on the PR row. Structurally what migration.ts builds,
 * kept here so the db layer does not import from the github layer. */
export interface EvalSummary {
  held: number;
  drifted: number;
  inconclusive: number;
  total: number;
}

export async function setPrEval(
  repoId: number,
  number: number,
  evalStatus: string,
  summary: EvalSummary,
): Promise<void> {
  await sql`
    update prs set eval_status = ${evalStatus}, eval_summary = ${sql.json(summary as never)}
    where repo_id = ${repoId} and number = ${number}`;
}
