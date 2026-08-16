import { sql } from "./db/index.ts";

export type JobType =
  | "scan" // payload: { repoId }
  | "onboard" // payload: { installationId, repoId }
  | "create_migration_pr" // payload: { repoId, registryId }
  | "rerun_pr" // payload: { repoId, prNumber }
  | "ingest_eval_results"; // payload: { repoId, prNumber, branch }

export interface Job {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: { runAfterSeconds?: number } = {},
): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into jobs (type, payload, run_after)
    values (${type}, ${sql.json(payload as never)}, now() + make_interval(secs => ${opts.runAfterSeconds ?? 0}))
    returning id`;
  return rows[0].id;
}

export async function claimNext(): Promise<Job | null> {
  const rows = await sql<Job[]>`
    update jobs set status = 'running', attempts = attempts + 1
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
  await sql`update jobs set status = 'done' where id = ${id}`;
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
