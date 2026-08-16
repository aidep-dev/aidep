import { sql } from "../db/index.ts";

/**
 * Dashboard read models. Death math is date-only: `today` is a YYYY-MM-DD
 * string passed in by the caller so pages and tests agree on what day it is.
 */

export interface RepoIndexRow {
  id: number;
  owner: string;
  name: string;
  private: boolean;
  onboarding_pr_number: number | null;
  onboarded_at: Date | null;
  /** open + pr_open findings */
  open_findings: number;
  /** of those, findings whose dies date is today or past: calls fail now */
  dead_findings: number;
  /** min dies strictly after today, YYYY-MM-DD; null when nothing is dated ahead */
  next_dies: string | null;
  /** distinct open aidep migration PRs (findings still pr_open) */
  open_prs: number;
}

export async function repoIndex(installationIds: number[], today: string): Promise<RepoIndexRow[]> {
  if (installationIds.length === 0) return [];
  return sql<RepoIndexRow[]>`
    select
      r.id, r.owner, r.name, r.private, r.onboarding_pr_number, r.onboarded_at,
      (count(f.id) filter (where f.status in ('open', 'pr_open')))::int as open_findings,
      (count(f.id) filter (where f.status in ('open', 'pr_open') and f.dies <= ${today}::date))::int as dead_findings,
      (min(f.dies) filter (where f.status in ('open', 'pr_open') and f.dies > ${today}::date))::text as next_dies,
      (count(distinct f.pr_id) filter (where f.status = 'pr_open'))::int as open_prs
    from repos r
    left join findings f on f.repo_id = r.id
    where r.installation_id = any(${installationIds}::bigint[])
    group by r.id
    order by dead_findings desc, next_dies asc nulls last, r.owner, r.name`;
}

export interface RepoFindingRow {
  id: number;
  registry_id: string;
  surface: string;
  path: string;
  line: number;
  matched: string;
  replacement_id: string | null;
  /** YYYY-MM-DD or null (no date announced) */
  dies: string | null;
  dies_is_earliest: boolean;
  status: "open" | "pr_open";
  /** set when this finding's migration PR is open */
  pr_number: number | null;
  eval_status: string | null;
}

export async function repoFindings(repoId: number): Promise<RepoFindingRow[]> {
  return sql<RepoFindingRow[]>`
    select
      f.id, f.registry_id, f.surface, f.path, f.line, f.matched, f.replacement_id,
      f.dies::text as dies, f.dies_is_earliest, f.status,
      p.number as pr_number, p.eval_status
    from findings f
    left join prs p on p.id = f.pr_id
    where f.repo_id = ${repoId} and f.status in ('open', 'pr_open')
    order by f.dies asc nulls last, f.path, f.line`;
}

export interface EventGroup {
  registryId: string;
  findings: RepoFindingRow[];
  /** the open migration PR for this event, if one exists */
  pr: { number: number; evalStatus: string } | null;
}

/**
 * Group findings by deprecation event (registry row id). Input order is by
 * urgency (dies asc), so groups come out most-urgent first. Workflow-file
 * findings stay status=open even when the event's PR is up, so a group's PR
 * is whatever any of its findings link to.
 */
export function groupByEvent(rows: RepoFindingRow[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const row of rows) {
    let g = groups.get(row.registry_id);
    if (!g) {
      g = { registryId: row.registry_id, findings: [], pr: null };
      groups.set(row.registry_id, g);
    }
    g.findings.push(row);
    if (row.status === "pr_open" && row.pr_number !== null) {
      g.pr = { number: row.pr_number, evalStatus: row.eval_status ?? "none" };
    }
  }
  return [...groups.values()];
}

/** Whole days from `today` to `dies`, both YYYY-MM-DD. Negative = past. */
export function daysUntil(dies: string, today: string): number {
  return Math.round((Date.parse(dies) - Date.parse(today)) / 86_400_000);
}
