import { createHmac, timingSafeEqual } from "node:crypto";
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
 * addresses someone typed into a file they merged or a form they submitted,
 * and only after that address clicked a confirmation link: the person who
 * typed it is not always the person who receives it (security review
 * 2026-08-21, findings 1 and 2). One confirmation mail per address, ever.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

export type Mailer = (mail: Mail) => Promise<void>;

/** Whether outbound mail is wired at all. When false, senders must not run:
 * the ledger records a mail as sent the moment the mailer resolves, and the
 * confirmation mail is one-per-address-ever, so a no-op send would burn it. */
export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

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
    const { error } = await client.emails.send({ from, to: mail.to, subject: mail.subject, text: mail.text, headers: mail.headers });
    if (error) throw new Error(`resend: ${error.message}`);
  };
}

export const WAITLIST_WINDOW_DAYS = 14;
const APP_URL = () => process.env.APP_URL ?? "https://aidep.example";
/** A flood of addresses costs cron runs, not one run's whole Resend quota. */
const MAX_CONFIRMATIONS_PER_RUN = 25;

/** Stateless confirmation token: HMAC of the lowercased address under the
 * session secret, so the link needs no row and cannot be forged. */
export function confirmToken(email: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be set");
  return createHmac("sha256", secret).update(email.toLowerCase()).digest("base64url");
}

export function confirmTokenMatches(email: string, token: string): boolean {
  const expected = Buffer.from(confirmToken(email));
  const got = Buffer.from(token);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function confirmUrl(email: string): string {
  const u = new URL("/api/notify/confirm", APP_URL());
  u.searchParams.set("e", email.toLowerCase());
  u.searchParams.set("t", confirmToken(email));
  return u.toString();
}

export async function confirmAddress(email: string): Promise<void> {
  await sql`insert into confirmed_addresses (email) values (${email.toLowerCase()}) on conflict do nothing`;
}

async function confirmedSet(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await sql<{ email: string }[]>`
    select email from confirmed_addresses where email = any(${emails})`;
  return new Set(rows.map((r) => r.email));
}

/** The stop link: GET is a page with one button, POST suppresses. Same HMAC
 * as the confirm link: holding the link proves control of the mailbox, and
 * the row outranks confirmation forever. */
export function stopUrl(email: string): string {
  const u = new URL("/api/notify/stop", APP_URL());
  u.searchParams.set("e", email.toLowerCase());
  u.searchParams.set("t", confirmToken(email));
  return u.toString();
}

/** RFC 8058: the mail client shows its own stop button and POSTs to the
 * stop URL with no page in between. */
function stopHeaders(email: string): Record<string, string> {
  return { "List-Unsubscribe": `<${stopUrl(email)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

export async function suppressAddress(email: string): Promise<void> {
  await sql`insert into suppressed_addresses (email) values (${email.toLowerCase()}) on conflict do nothing`;
}

async function suppressedSet(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await sql<{ email: string }[]>`
    select email from suppressed_addresses where email = any(${emails})`;
  return new Set(rows.map((r) => r.email));
}

function confirmMail(to: string, why: string): Mail {
  return {
    to,
    subject: "Confirm your address for aidep",
    text: [
      `Someone ${why}. If that was you, confirm here and aidep will write when it matters:`,
      "",
      confirmUrl(to),
      "",
      "If it was not you, do nothing: this is the only mail this address gets until the link is clicked.",
      `Never want aidep mail at this address? Stop it for good with one button here: ${stopUrl(to)}`,
    ].join("\n"),
    headers: stopHeaders(to),
  };
}

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
  to: string,
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
    `You get this because your address is in .github/aidep.json on ${full}. Remove it there, or stop all aidep mail to this address with one button here: ${stopUrl(to)}`,
    "",
    "aidep sends nothing else and never opens a PR you did not ask for.",
  ].join("\n");
  return { to, subject, text, headers: stopHeaders(to) };
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
} = {}): Promise<{ exposure: number; waitlist: number; confirmations: number }> {
  // No mail wiring, no sends and no ledger writes: the no-op mailer resolves
  // like a success, and the one-ever confirmation must not be spent on it.
  if (opts.mailer === undefined && !mailConfigured()) {
    return { exposure: 0, waitlist: 0, confirmations: 0 };
  }
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
  const notifyAddresses = [...new Set([...byRepo.values()].flatMap((es) => es[0].notify.map((a) => a.toLowerCase())))];
  const confirmed = await confirmedSet(notifyAddresses);
  const suppressed = await suppressedSet(notifyAddresses);
  let confirmations = 0;
  for (const events of byRepo.values()) {
    const repo = events[0];
    for (const to of repo.notify.map((a) => a.toLowerCase())) {
      if (suppressed.has(to)) continue;
      if (!confirmed.has(to)) {
        if (confirmations < MAX_CONFIRMATIONS_PER_RUN && (await alreadySent("confirm", to, ["confirm"])).size === 0) {
          await mailer(confirmMail(to, `put this address in .github/aidep.json on ${repo.owner}/${repo.name}`));
          await record("confirm", to, ["confirm"]);
          confirmations++;
        }
        continue;
      }
      const keys = events.map((e) => `${e.repo_id}:${e.registry_id}`);
      const sent = await alreadySent("exposure", to, keys);
      const fresh = events.filter((e) => !sent.has(`${e.repo_id}:${e.registry_id}`));
      if (fresh.length === 0) continue;
      await mailer(exposureMail(to, repo, fresh, today, registry));
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
  // The confirmation is not gated on a date being close: someone who signs
  // up in a quiet stretch confirms now and hears from us when it matters,
  // instead of getting their first mail weeks after they typed the address.
  const emails = (
    await sql<{ email: string }[]>`
      select distinct lower(email) as email from interest
      where email is not null and source = 'landing-waitlist'`
  ).map((r) => r.email);
  const confirmedWaiters = await confirmedSet(emails);
  const suppressedWaiters = await suppressedSet(emails);
  for (const email of emails) {
    if (suppressedWaiters.has(email)) continue;
    if (!confirmedWaiters.has(email)) {
      if (confirmations < MAX_CONFIRMATIONS_PER_RUN && (await alreadySent("confirm", email, ["confirm"])).size === 0) {
        await mailer(confirmMail(email, "left this address on aidep.dev asking to hear when a retirement date gets close"));
        await record("confirm", email, ["confirm"]);
        confirmations++;
      }
      continue;
    }
    if (dates.size === 0) continue;
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
          `You asked for this on aidep.dev. It goes out once per retirement date and nothing else. Stop with one button here: ${stopUrl(email)}`,
        ].join("\n"),
        headers: stopHeaders(email),
      });
      await record("waitlist", email, [dies]);
      waitlist++;
    }
  }

  // intents that landed after this hour's alert went out
  await upgradeAlert(mailer);

  return { exposure, waitlist, confirmations };
}

/**
 * One mail to the operator's own inbox (the MAIL_FROM address, which routes
 * to a real mailbox). Used for signals that promise a same-day human reply,
 * so they cannot depend on someone remembering to run SQL. The caller
 * decides whether mail is wired; the route treats failure as non-fatal.
 */
async function operatorAlert(subject: string, text: string, mailer: Mailer): Promise<void> {
  const from = process.env.MAIL_FROM ?? "";
  const to = /<([^>]+)>/.exec(from)?.[1] ?? from;
  await mailer({ to, subject, text });
}

/**
 * Upgrade intents from /pricing, at most one mail an hour: whoever claims the
 * hour's ledger row reports every intent since the previous mail, the rest
 * wait for the next claim (the next intent, or the next cron drain once the
 * hour has turned). The row is claimed before the send so two requests in
 * the same second cannot both mail; that is the flood this exists for, and
 * a lost hour costs nothing that /api/funnel does not still show.
 */
export async function upgradeAlert(mailer?: Mailer): Promise<boolean> {
  if (mailer === undefined && !mailConfigured()) return false;
  // timestamps stay text end to end (the ::text cast keeps postgres.js from
  // serializing the parameter through a JS Date): a Date keeps milliseconds,
  // Postgres keeps microseconds, and a rounded watermark re-reports intents
  const [prev] = await sql<{ at: string | null }[]>`
    select max(sent_at)::text as at from notifications where kind = 'operator' and recipient = 'upgrade'`;
  const since = prev.at ?? "epoch";
  const fresh = await sql<{ email: string | null; created_at: string }[]>`
    select email, created_at::text as created_at from interest
    where source = 'pricing-upgrade' and created_at > ${since}::text::timestamptz
    order by created_at`;
  if (fresh.length === 0) return false;
  // sent_at is the newest intent reported, not the clock: a row that lands
  // between the select above and this insert is picked up by the next claim
  const claimed = await sql`
    insert into notifications (kind, recipient, subject_key, sent_at)
    values ('operator', 'upgrade', ${new Date().toISOString().slice(0, 13)}, ${fresh[fresh.length - 1].created_at}::text::timestamptz)
    on conflict do nothing
    returning 1`;
  if (claimed.length === 0) return false;
  const n = fresh.length;
  await operatorAlert(
    `aidep: ${n === 1 ? "1 upgrade intent" : `${n} upgrade intents`}`,
    [
      `${n === 1 ? "Someone" : `${n} people`} clicked upgrade on /pricing since ${prev.at ?? "launch"}.`,
      "",
      ...fresh.map((r) => r.email ?? "(no email left)"),
      "",
      "Reply today; the page said we would. Next mail like this in an hour at the earliest.",
    ].join("\n"),
    mailer ?? resendMailer(),
  );
  return true;
}

/** Exposure mail covers events inside this window with an urgent subject. */
export { URGENT_WINDOW_DAYS };
