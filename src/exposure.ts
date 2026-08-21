import { sql } from "./db/index.ts";
import { loadRegistry, type RegistryRow } from "./registry.ts";

export interface ExposureRow {
  registry_id: string;
  query: string;
  files: number;
  counted_at: string;
}

/**
 * Whether an identifier is distinctive enough that a code-search count means
 * anything. Legacy ids like "ada" and "babbage" are ordinary English and match
 * hundreds of millions of files as substrings, so a count against them is
 * noise dressed as evidence. Require either a version-ish shape (a digit plus
 * a separator) or a long dotted/slashed API path.
 */
export function isSearchable(id: string): boolean {
  const hasSeparator = /[-./]/.test(id);
  const hasDigit = /\d/.test(id);
  if (hasSeparator && hasDigit && id.length >= 6) return true;
  return /[./]/.test(id) && id.length >= 12;
}

/** A count this large is a substring artifact, not exposure. */
export const IMPLAUSIBLE_FILE_COUNT = 5_000_000;

/** Whole days between a dies date and now, unsigned. Dateless sorts last. */
export function distanceFromNow(dies: string | null, now: Date): number {
  if (dies === null) return Number.MAX_SAFE_INTEGER;
  const [y, m, d] = dies.split("-").map(Number);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.abs(Date.UTC(y, m - 1, d) - today) / 86_400_000;
}

/**
 * The one query we publish per deprecation. A count is only worth showing if a
 * reader can paste the string into GitHub search and get the same number, so
 * each row publishes exactly one query rather than a sum across several.
 */
export function queryFor(row: RegistryRow): string | null {
  if (row.surface === "model") return row.api_ids.find(isSearchable) ?? null;
  // endpoints/features have many call shapes; pick the most idiomatic single
  // one rather than a band nobody can reproduce
  const preferred = ["client.beta.threads", "/v1/prompts", "/v1/assistants"];
  return row.api_ids.find((id) => preferred.includes(id)) ?? null;
}

/**
 * The numbers on the front page's closing band. Every one is either a sum
 * over public GitHub code-search counts or a count of rows in our own tables,
 * so each gets truer as the product is used and none is typed by hand.
 */
export async function impactFigures(): Promise<{
  exposedFiles: number;
  queriesCounted: number;
  reposWatched: number;
}> {
  const [row] = await sql<{ exposed: string; queries: string; repos: string }[]>`
    select
      (select coalesce(sum(files), 0) from exposure_counts) as exposed,
      (select count(*) from exposure_counts) as queries,
      (select count(*) from repos where onboarded_at is not null) as repos`;
  return {
    exposedFiles: Number(row?.exposed ?? 0),
    queriesCounted: Number(row?.queries ?? 0),
    reposWatched: Number(row?.repos ?? 0),
  };
}

/** Read the stored snapshot, most exposed first. */
export async function listExposure(limit = 40): Promise<ExposureRow[]> {
  return sql<ExposureRow[]>`
    select registry_id, query, files, counted_at
    from exposure_counts
    order by files desc
    limit ${limit}`;
}

/**
 * Refresh counts from GitHub code search. Rate limited to 10 req/min, so this
 * runs daily over a bounded slice and spaces its calls. Failures are skipped,
 * never written as zero: a zero on the page reads as "nobody is exposed",
 * which is the opposite of what a failed request means.
 */
export async function refreshExposure(opts: {
  token: string;
  rows?: RegistryRow[];
  max?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ updated: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const rows = opts.rows ?? (await loadRegistry());

  // Counts we already hold, so each run extends coverage instead of
  // re-counting the same handful every day.
  const seen = new Map(
    (
      await sql<{ registry_id: string; counted_at: string }[]>`
        select registry_id, counted_at from exposure_counts`
    ).map((r) => [r.registry_id, new Date(r.counted_at).getTime()]),
  );

  const targets = rows
    .filter((r) => r.status === "retired" || r.status === "deprecated")
    .map((r) => ({ row: r, query: queryFor(r) }))
    .filter((t): t is { row: RegistryRow; query: string } => t.query !== null)
    .sort((a, b) => {
      // Never-counted rows first (coverage grows), then the stalest, and
      // within that, nearness to today in either direction: just-died and
      // dying-soon are what a reader acts on. A 2023 Codex model is true but
      // nobody runs it; a 2027 date is nobody's problem yet.
      const sa = seen.get(a.row.id) ?? 0;
      const sb = seen.get(b.row.id) ?? 0;
      if (sa !== sb) return sa - sb;
      return distanceFromNow(a.row.dies, now) - distanceFromNow(b.row.dies, now);
    })
    .slice(0, opts.max ?? 16);

  let updated = 0;
  let skipped = 0;
  for (const [i, t] of targets.entries()) {
    if (i > 0) await sleep(7000); // 10 req/min ceiling
    try {
      const res = await fetchImpl(
        `https://api.github.com/search/code?q=${encodeURIComponent(`"${t.query}"`)}`,
        {
          headers: {
            authorization: `Bearer ${opts.token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
        },
      );
      if (!res.ok) {
        skipped++;
        continue;
      }
      const data = (await res.json()) as { total_count?: number };
      if (typeof data.total_count !== "number" || data.total_count > IMPLAUSIBLE_FILE_COUNT) {
        // a count that large means the string matched as an ordinary substring
        skipped++;
        continue;
      }
      await sql`
        insert into exposure_counts (registry_id, query, files, counted_at)
        values (${t.row.id}, ${t.query}, ${data.total_count}, now())
        on conflict (registry_id) do update set
          query = ${t.query}, files = ${data.total_count}, counted_at = now()`;
      updated++;
    } catch {
      skipped++;
    }
  }
  return { updated, skipped };
}
