import { bearerMatches } from "../../../src/auth/access.ts";
import { sql } from "../../../src/db/index.ts";

/**
 * The funnel, as counts over rows we already keep. docs/discovery.md sets
 * the Day 7 and Day 30 targets these are read against; nothing here is
 * typed by hand. Same bearer as /api/check:
 *
 *   curl -H "authorization: Bearer $CRON_SECRET" https://aidep.dev/api/funnel
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(req.headers.get("authorization"), secret)) {
    return new Response("unauthorized", { status: 401 });
  }
  const [row] = await sql<
    {
      installations: string;
      repos: string;
      onboarded: string;
      pending: string;
      migration_prs: string;
      merged: string;
      held: string;
      paid: string;
      waitlist: string;
      upgrade: string;
      upgrade_with_email: string;
    }[]
  >`
    select
      (select count(*) from installations) as installations,
      (select count(*) from repos) as repos,
      (select count(*) from repos where onboarded_at is not null) as onboarded,
      (select count(*) from repos where onboarded_at is null and onboarding_pr_number is not null) as pending,
      (select count(*) from prs) as migration_prs,
      (select count(*) from prs where merged_at is not null) as merged,
      (select count(*) from prs where eval_status = 'held') as held,
      (select count(*) from installations where paid) as paid,
      (select count(distinct email) from interest where source = 'landing-waitlist' and email is not null) as waitlist,
      (select count(*) from interest where source = 'pricing-upgrade') as upgrade,
      (select count(distinct email) from interest where source = 'pricing-upgrade' and email is not null) as upgrade_with_email`;
  const n = (v: string) => Number(v);
  return Response.json({
    installs: n(row.installations),
    repos: { total: n(row.repos), onboarded: n(row.onboarded), onboarding_pr_open: n(row.pending) },
    migration_prs: { requested: n(row.migration_prs), merged: n(row.merged), eval_held: n(row.held) },
    paid_orgs: n(row.paid),
    interest: { waitlist_emails: n(row.waitlist), upgrade_clicks: n(row.upgrade), upgrade_emails: n(row.upgrade_with_email) },
  });
}
