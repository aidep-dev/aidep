import { sql } from "./db/index.ts";

/** The payload each job type carries. Every enqueue and every handler branch
 * reads from here, so a new field is a type error at both ends rather than an
 * undefined at runtime. */
export interface JobPayloads {
  scan: { repoId: number; headSha?: string | null; rereadConfig?: boolean };
  onboard: { repoId: number; installationId?: number; refresh?: boolean };
  create_migration_pr: { repoId: number; registryId: string };
  rerun_pr: { repoId: number; prNumber: number };
  ingest_eval_results: { repoId: number; prNumber: number | null; branch: string };
}

export type JobType = keyof JobPayloads;

export type Job = {
  [K in JobType]: { id: number; type: K; payload: JobPayloads[K]; attempts: number };
}[JobType];

export const MAX_ATTEMPTS = 5;

export async function enqueue<K extends JobType>(
  type: K,
  payload: JobPayloads[K],
  opts: { runAfterSeconds?: number } = {},
): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into jobs (type, payload, run_after)
    values (${type}, ${sql.json(payload as never)}, now() + make_interval(secs => ${opts.runAfterSeconds ?? 0}))
    returning id`;
  return rows[0].id;
}

export async function claimNext(): Promise<Job | null> {
  // enqueue() above is the only writer of this column and it is typed, so the
  // row shape is our own data round-tripping, not third-party input.
  const rows = await sql<Job[]>`
    update jobs set status = 'running', attempts = attempts + 1, claimed_at = now()
    where id = (
      select id from jobs
      where status = 'queued' and run_after <= now()
      order by run_after
      for update skip locked
      limit 1
    )
    returning id, type, payload, attempts`;
  return rows[0] ?? null;
}

export async function complete(id: number): Promise<void> {
  // clear last_error too: a job that failed then succeeded on retry should not
  // keep the stale error around.
  await sql`update jobs set status = 'done', last_error = null where id = ${id}`;
}

export async function fail(id: number, error: string, attempts: number): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await sql`update jobs set status = 'failed', last_error = ${error.slice(0, 2000)} where id = ${id}`;
  } else {
    // 1m, 4m, 9m, 16m backoff
    await sql`
      update jobs set status = 'queued', last_error = ${error.slice(0, 2000)},
        run_after = now() + make_interval(secs => ${attempts * attempts * 60})
      where id = ${id}`;
  }
}

/**
 * Claim and run queued jobs until the queue is empty or `max` jobs ran.
 * Used by the cron drain route and, inline, by after() in the webhook route.
 */
export async function drain(
  handler: (job: Job) => Promise<void>,
  opts: { max?: number } = {},
): Promise<{ ran: number; failed: number }> {
  let ran = 0;
  let failed = 0;
  const max = opts.max ?? 20;
  while (ran < max) {
    const job = await claimNext();
    if (!job) break;
    ran++;
    try {
      await handler(job);
      await complete(job.id);
    } catch (e) {
      failed++;
      await fail(job.id, e instanceof Error ? (e.stack ?? e.message) : String(e), job.attempts);
    }
  }
  return { ran, failed };
}
