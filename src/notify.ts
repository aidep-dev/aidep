import { Resend } from "resend";
import { DEFAULT_CONFIG, AidepConfigSchema } from "./config.ts";
import { isUrgentEvent, URGENT_WINDOW_DAYS } from "./dashboard/queries.ts";
import { sql } from "./db/index.ts";
import { loadRegistry, type RegistryRow } from "./registry.ts";

/**
 * The push channel. An agent is pull; deprecations are push. After
 * onboarding, the only way a repo owner hears about a new exposure or an
 * approaching date without visiting the dashboard is this file.
 *
 * Two kinds of mail, both plain text, both sent at most once per subject
 * per recipient (the notifications table is the ledger):
 *
 *   exposure  to the repo's `notify` addresses: every open finding event not
 *             yet announced to that address, plus any event inside the
 *             30-day window, as one digest per repo
 *   waitlist  to addresses left on the landing page: what dies on a date
 *             within 14 days, once per date
 *
 * aidep never opens a PR or an issue it was not asked for; mail goes only to
 * addresses someone typed into a file they merged or a form they submitted.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

/** Production: Resend, or a log line when unconfigured. Tests inject. */
export function resendMailer(): Mailer {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    return async (mail) => {
      console.log(`mail skipped (RESEND_API_KEY/MAIL_FROM unset): "${mail.subject}" -> ${mail.to}`);
    };
  }
  const client = new Resend(key);
  return async (mail) => {
    const { error } = await client.emails.send({ from, to: mail.to, subject: mail.subject, text: mail.text });
    if (error) throw new Error(`resend: ${error.message}`);
  };
}

const WAITLIST_WINDOW_DAYS = 14;
const APP_URL = () => process.env.APP_URL ?? "https://aidep.example";

function daysUntil(dies: string, today: string): number {
  return Math.round((Date.parse(dies) - Date.parse(today)) / 86_400_000);
}

function when(dies: string | null, today: string): string {
  if (dies === null) return "no date announced";
  const d = daysUntil(dies, today);
  if (d < 0) return `retired ${dies}; calls fail today`;
  if (d === 0) return `dies today, ${dies}`;
  return `dies ${dies} (${d === 1 ? "1 day" : `${d} days`})`;
}

function slug(registryId: string): string {
  const parts = registryId.split(":");
  return parts[parts.length - 1];
}

interface ExposureRow {
  repo_id: number;
  owner: string;
  name: string;
  notify: string[];
  registry_id: string;
  dies: string | null;
  sites: number;
  paths: string[];
}

/**
 * Open finding events on onboarded, unsuspended repos whose config names at
 * least one address, rolled up per (repo, event) with the first few paths.
 */
async function openEvents(): Promise<ExposureRow[]> {
  const rows = await sql<Array<Omit<ExposureRow, "notify"> & { config: unknown }>>`
    select
      r.id as repo_id, r.owner, r.name, r.config,
      f.registry_id, f.dies::text as dies,
      count(*)::int as sites,
      (array_agg(distinct f.path order by f.path))[1:3] as paths
    from repos r
    join installations i on i.id = r.installation_id
    join findings f on f.repo_id = r.id
    where r.onboarded_at is not null
      and i.suspended_at is null
      and f.status in ('open', 'pr_open')
      and jsonb_array_length(coalesce(r.config->'notify', '[]'::jsonb)) > 0
    group by r.id, r.owner, r.name, r.config, f.registry_id, f.dies
    order by r.id, f.dies asc nulls last, f.registry_id`;
  return rows.map(({ config, ...r }) => {
    // the stored config is our own parse output; re-validate rather than trust the column
    const parsed = AidepConfigSchema.safeParse(config);
    return { ...r, notify: parsed.success ? parsed.data.notify : DEFAULT_CONFIG.notify };
  });
}

async function alreadySent(kind: string, recipient: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await sql<{ subject_key: string }[]>`
    select subject_key from notifications
    where kind = ${kind} and recipient = ${recipient} and subject_key = any(${keys})`;
  return new Set(rows.map((r) => r.subject_key));
}

async function record(kind: string, recipient: string, keys: string[]): Promise<void> {
  for (const key of keys) {
    await sql`
      insert into notifications (kind, recipient, subject_key)
      values (${kind}, ${recipient}, ${key})
      on conflict do nothing`;
  }
}

function exposureMail(
  repo: { owner: string; name: string },
  events: ExposureRow[],
  today: string,
  registry: Map<string, RegistryRow>,
): Mail {
  const full = `${repo.owner}/${repo.name}`;
  const urgent = events.filter((e) => isUrgentEvent(e.dies, today));
  const lines = events.map((e) => {
    const reg = registry.get(e.registry_id);
    const replacement = reg?.replacement_id === null || reg === undefined ? "" : `, replacement ${slug(reg.replacement_id)}`;
    const paths = e.paths.join(", ") + (e.sites > e.paths.length ? `, +${e.sites - e.paths.length} more` : "");
    return `- ${slug(e.registry_id)} (${e.registry_id.split(":")[0]}): ${when(e.dies, today)}${replacement}\n  ${paths}`;
  });
  const nearest = events.map((e) => e.dies).filter((d): d is string => d !== null).sort()[0];
  const subject =
    urgent.length > 0
      ? `${full}: ${slug(urgent[0].registry_id)} ${when(urgent[0].dies, today)}`
      : `${full}: ${events.length === 1 ? "1 exposure" : `${events.length} exposures`}${nearest ? `, nearest ${nearest}` : ""}`;
  const text = [
    `aidep found calls in ${full} to models or APIs with a retirement on file.`,
    "",
    ...lines,
    "",
    `Details and the migration PR button: ${APP_URL()}/dashboard/${full}`,
    "",
    `You get this because your address is in .github/aidep.json on ${full}. Remove it there to stop. aidep sends nothing else and never opens a PR you did not ask for.`,
  ].join("\n");
  return { to: "", subject, text };
}

/**
 * Send every due mail. Idempotent: a second call with nothing new sends
 * nothing. `rows` and `now` are injectable so tests do not read the clock or
 * the live registry.
 */
export async function sendDueNotifications(opts: {
  mailer?: Mailer;
  rows?: RegistryRow[];
  now?: string;
} = {}): Promise<{ exposure: number; waitlist: number }> {
  const mailer = opts.mailer ?? resendMailer();
  const today = opts.now ?? new Date().toISOString().slice(0, 10);
  const rows = opts.rows ?? (await loadRegistry());
  const registry = new Map(rows.map((r) => [r.id, r]));
  let exposure = 0;
  let waitlist = 0;

  // exposure digests, one per (repo, recipient), covering events not yet
  // announced to that recipient
  const byRepo = new Map<number, ExposureRow[]>();
  for (const e of await openEvents()) {
    const list = byRepo.get(e.repo_id) ?? [];
    list.push(e);
    byRepo.set(e.repo_id, list);
  }
  for (const events of byRepo.values()) {
    const repo = events[0];
    for (const to of repo.notify) {
      const keys = events.map((e) => `${e.repo_id}:${e.registry_id}`);
      const sent = await alreadySent("exposure", to, keys);
      const fresh = events.filter((e) => !sent.has(`${e.repo_id}:${e.registry_id}`));
      if (fresh.length === 0) continue;
      await mailer({ ...exposureMail(repo, fresh, today, registry), to });
      await record("exposure", to, fresh.map((e) => `${e.repo_id}:${e.registry_id}`));
      exposure++;
    }
  }

  // waitlist: what dies within 14 days, once per date per address
  const dates = new Map<string, RegistryRow[]>();
  for (const r of rows) {
    if (r.dies === null) continue;
    const d = daysUntil(r.dies, today);
    if (d < 0 || d > WAITLIST_WINDOW_DAYS) continue;
    const list = dates.get(r.dies) ?? [];
    list.push(r);
    dates.set(r.dies, list);
  }
  if (dates.size > 0) {
    const emails = await sql<{ email: string }[]>`
      select distinct email from interest where email is not null and source = 'landing-waitlist'`;
    for (const { email } of emails) {
      const sent = await alreadySent("waitlist", email, [...dates.keys()]);
      for (const [dies, dying] of dates) {
        if (sent.has(dies)) continue;
        const ids = dying.map((r) => slug(r.id));
        const shown = ids.slice(0, 8).join(", ") + (ids.length > 8 ? `, +${ids.length - 8} more` : "");
        await mailer({
          to: email,
          subject: `${ids.length === 1 ? ids[0] : `${ids.length} retirements`} on ${dies} (${daysUntil(dies, today)} days)`,
          text: [
            `On ${dies} the following stop answering: ${shown}.`,
            "",
            `Check your code now: npx aidep . needs no account. Or install the GitHub App: ${APP_URL()}`,
            "",
            "You asked for this on aidep.dev. It goes out once per retirement date and nothing else. Reply to stop.",
          ].join("\n"),
        });
        await record("waitlist", email, [dies]);
        waitlist++;
      }
    }
  }

  return { exposure, waitlist };
}

/** Exposure mail covers events inside this window with an urgent subject. */
export { URGENT_WINDOW_DAYS };
