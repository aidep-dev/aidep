import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "../../../../src/db/index.ts";
import { drain, MAX_ATTEMPTS } from "../../../../src/jobs.ts";
import { runJob } from "../../../../src/pipeline.ts";
import { refreshExposure } from "../../../../src/exposure.ts";
import { loadRegistry } from "../../../../src/registry.ts";

/**
 * The onboarding PR promises scans "whenever the deprecation registry
 * changes". Compare the current registry content hash against the last one
 * seen; on change, mark every onboarded repo stale by enqueueing scans
 * (deduped against pending scan jobs).
 */
async function rescanOnRegistryChange(): Promise<number> {
  let hash: string;
  try {
    const rows = await loadRegistry();
    hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  } catch (e) {
    console.error("registry load failed:", e);
    return 0; // registry source unreachable; scheduled rescans still run
  }
  const prev = await sql<{ value: string }[]>`select value from meta where key = 'registry_hash'`;
  if (prev[0]?.value === hash) return 0;
  const enqueued = await sql<{ id: number }[]>`
    insert into jobs (type, payload)
    select 'scan', jsonb_build_object('repoId', r.id)
    from repos r
    join installations i on i.id = r.installation_id
    left join jobs j on j.type = 'scan' and j.status in ('queued', 'running')
      and (j.payload->>'repoId')::bigint = r.id
    where r.onboarded_at is not null and i.suspended_at is null and j.id is null
    returning id`;
  await sql`
    insert into meta (key, value) values ('registry_hash', ${hash})
    on conflict (key) do update set value = ${hash}`;
  return enqueued.length;
}

/** Constant-time bearer-token check that never throws on a length mismatch. */
function bearerMatches(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Vercel cron target (see vercel.json): enqueue scheduled rescans for stale
 * repos, then drain the job queue.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    // Vercel cron sends "Authorization: Bearer $CRON_SECRET" automatically
    // whenever the env var exists on the project. Constant-time compare.
    if (!bearerMatches(req.headers.get("authorization"), secret)) {
      return new Response("unauthorized", { status: 401 });
    }
  } else if (process.env.NODE_ENV !== "development") {
    // No secret configured: only local development may drain unauthenticated.
    return new Response("unauthorized", { status: 401 });
  }

  // Recover jobs wedged in 'running' by a crash between claim and
  // complete/fail: requeue them so the queue drains and the scan debounce
  // stops treating them as pending, or fail them once attempts are spent so a
  // permanently-broken job isn't re-run every cron. 15m sits comfortably above
  // the serverless maxDuration, so a still-running job is never touched.
  await sql`
    update jobs
    set status = case when attempts >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end
    where status = 'running' and claimed_at < now() - interval '15 minutes'`;

  // Scheduled rescans: onboarded, unsuspended repos whose most recent finished
  // scan is older than their schedule (daily = 24h, weekly = 7d; default
  // daily), unless a scan job is already queued. A repo with no finished scan
  // counts as stale (coalesce to epoch).
  const enqueued = await sql<{ id: number }[]>`
    insert into jobs (type, payload)
    select 'scan', jsonb_build_object('repoId', r.id)
    from repos r
    join installations i on i.id = r.installation_id
    left join (
      select repo_id, max(finished_at) as last_finished
      from scans where status = 'done'
      group by repo_id
    ) ls on ls.repo_id = r.id
    left join jobs j on j.type = 'scan' and j.status in ('queued', 'running')
      and (j.payload->>'repoId')::bigint = r.id
    where r.onboarded_at is not null
      and i.suspended_at is null
      and j.id is null
      and coalesce(ls.last_finished, 'epoch'::timestamptz) <
        now() - case when r.config->>'schedule' = 'weekly'
          then interval '7 days' else interval '1 day' end
    returning id`;

  const registryTriggered = await rescanOnRegistryChange();

  // Public exposure counts for /dead, refreshed at most daily. Code search is
  // 10 req/min, so this walks a bounded slice and spaces its calls; a failed
  // request leaves the previous number standing rather than writing a zero.
  let exposure = { updated: 0, skipped: 0 };
  const ghToken = process.env.GITHUB_SEARCH_TOKEN;
  if (ghToken) {
    const [last] = await sql<{ counted_at: string }[]>`
      select max(counted_at) as counted_at from exposure_counts`;
    const stale =
      !last?.counted_at || Date.now() - new Date(last.counted_at).getTime() > 20 * 60 * 60 * 1000;
    if (stale) exposure = await refreshExposure({ token: ghToken });
  }

  const r = await drain(runJob, { max: 25 });
  return Response.json({ enqueued: enqueued.length, registryTriggered, exposure, ...r });
}
