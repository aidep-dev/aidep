import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AidepConfigSchema } from "../src/config.ts";
import { markOnboarded, sql, upsertInstallation, upsertRepo } from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { GET as confirmPage, POST as confirmRoute } from "../app/api/notify/confirm/route.ts";
import { GET as stopPage, POST as stopRoute } from "../app/api/notify/stop/route.ts";
import { confirmAddress, confirmUrl, sendDueNotifications, stopUrl, upgradeAlert, type Mail, type Mailer } from "../src/notify.ts";
import { MINI_REGISTRY } from "./mini-registry.ts";

process.env.SESSION_SECRET ??= "test-session-secret";

// id range owned by this file: installations 80xx, repos 81xx
const INST = 8001;
const REPO = 8101;
const REPO_SILENT = 8102;

const TODAY = "2026-08-16";
const ASSISTANTS = "openai:endpoint:assistants-api"; // dies 2026-08-26, inside the 30-day window
const GPT4_TURBO = "openai:model:gpt-4-turbo"; // dies 2026-10-23
const DOMAIN = "notify.test";
const OWNER = `owner@${DOMAIN}`;
const WAITER = `waiter@${DOMAIN}`;

async function seedFinding(repoId: number, registryId: string, path: string, dies: string | null): Promise<void> {
  await sql`
    insert into findings (repo_id, registry_id, surface, path, line, matched, dies)
    values (${repoId}, ${registryId}, ${registryId.split(":")[1]}, ${path}, 1, ${registryId.split(":")[2]}, ${dies})`;
}

function collect() {
  const mails: Mail[] = [];
  const mailer: Mailer = async (m) => void mails.push(m);
  return { mails, mailer };
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`delete from installations where id between 8000 and 8999`;
  await sql`delete from notifications where recipient like ${`%@${DOMAIN}`} or kind = 'operator'`;
  await sql`delete from interest where email like ${`%@${DOMAIN}`}`;
  await sql`delete from confirmed_addresses where email like ${`%@${DOMAIN}`}`;
  await sql`delete from suppressed_addresses where email like ${`%@${DOMAIN}`}`;
  // the exposure and waitlist cases start from confirmed addresses; the
  // confirmation flow has its own cases below
  await confirmAddress(OWNER);
  await confirmAddress(WAITER);
  await upsertInstallation(INST, "acme");
  await upsertRepo({ id: REPO, installationId: INST, owner: "acme", name: "bot", defaultBranch: "main" });
  await upsertRepo({ id: REPO_SILENT, installationId: INST, owner: "acme", name: "quiet", defaultBranch: "main" });
  await markOnboarded(REPO, AidepConfigSchema.parse({ notify: [OWNER] }));
  await markOnboarded(REPO_SILENT, AidepConfigSchema.parse({}));
  await seedFinding(REPO, ASSISTANTS, "src/assist.py", "2026-08-26");
  await seedFinding(REPO, ASSISTANTS, "src/threads.py", "2026-08-26");
  await seedFinding(REPO, GPT4_TURBO, "src/chat.py", "2026-10-23");
  await seedFinding(REPO_SILENT, GPT4_TURBO, "src/chat.py", "2026-10-23");
});

describe("exposure mail", () => {
  it("sends one digest per recipient, urgent event in the subject, and nothing the second time", async () => {
    const { mails, mailer } = collect();
    const first = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(first.exposure).toBe(1);
    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m.to).toBe(OWNER);
    expect(m.subject).toBe("acme/bot: assistants-api dies 2026-08-26 (10 days)");
    expect(m.text).toContain("- assistants-api (openai): dies 2026-08-26 (10 days), replacement responses-api\n  src/assist.py, src/threads.py");
    expect(m.text).toContain("- gpt-4-turbo (openai): dies 2026-10-23 (68 days)\n  src/chat.py");
    expect(m.text).toContain("/dashboard/acme/bot");
    expect(m.text).toContain("Remove it there, or stop all aidep mail");

    const second = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(second.exposure).toBe(0);
    expect(mails).toHaveLength(1);
  });

  it("mails only what is new once an event appears later", async () => {
    const { mails, mailer } = collect();
    await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    await seedFinding(REPO, "anthropic:model:claude-3-5-sonnet-20241022", "src/claude.py", "2025-10-28");
    const r = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(r.exposure).toBe(1);
    expect(mails[1].subject).toBe("acme/bot: claude-3-5-sonnet-20241022 retired 2025-10-28; calls fail today");
    expect(mails[1].text).not.toContain("gpt-4-turbo");
  });

  it("says nothing about a repo with no notify address", async () => {
    const { mails, mailer } = collect();
    await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(mails.every((m) => !m.text.includes("acme/quiet"))).toBe(true);
  });

  it("records nothing when the mailer throws, so the next run retries", async () => {
    await expect(
      sendDueNotifications({ mailer: async () => { throw new Error("smtp down"); }, rows: MINI_REGISTRY, now: TODAY }),
    ).rejects.toThrow("smtp down");
    const rows = await sql`select 1 from notifications where recipient = ${OWNER}`;
    expect(rows).toHaveLength(0);
    const { mails, mailer } = collect();
    await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(mails).toHaveLength(1);
  });
});

describe("confirmation", () => {
  const NEW = `New.Person@${DOMAIN}`;

  it("sends one confirmation to an unconfirmed notify address and no digest, then the digest once confirmed", async () => {
    await markOnboarded(REPO, AidepConfigSchema.parse({ notify: [NEW] }));
    const { mails, mailer } = collect();
    const first = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(first).toEqual({ exposure: 0, waitlist: 0, confirmations: 1 });
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe(NEW.toLowerCase());
    expect(mails[0].subject).toBe("Confirm your address for aidep");
    expect(mails[0].text).toContain("acme/bot");
    expect(mails[0].text).not.toContain("src/assist.py");

    // nothing more until the link is clicked, not even a second confirmation
    const again = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(again).toEqual({ exposure: 0, waitlist: 0, confirmations: 0 });
    expect(mails).toHaveLength(1);

    // the link itself is a page with one button: a scanner fetching it confirms nothing
    const page = await confirmPage(new Request(confirmUrl(NEW)));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain('<form method="post">');
    expect(await sql`select 1 from confirmed_addresses where email = ${NEW.toLowerCase()}`).toHaveLength(0);

    const res = await confirmRoute(new Request(confirmUrl(NEW), { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("when a scan finds a new exposure or a retirement date gets close, and for nothing else. Remove the address from .github/aidep.json");
    const third = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(third.exposure).toBe(1);
    expect(mails[1].to).toBe(NEW.toLowerCase());
    expect(mails[1].text).toContain("src/assist.py");
  });

  it("rejects a forged or mismatched token", async () => {
    const good = new URL(confirmUrl(NEW));
    const forged = new URL(good);
    forged.searchParams.set("t", good.searchParams.get("t")!.replace(/.$/, (c) => (c === "A" ? "B" : "A")));
    expect((await confirmRoute(new Request(forged, { method: "POST" }))).status).toBe(400);
    expect((await confirmPage(new Request(forged))).status).toBe(400);
    const swapped = new URL(good);
    swapped.searchParams.set("e", `other@${DOMAIN}`);
    expect((await confirmRoute(new Request(swapped, { method: "POST" }))).status).toBe(400);
    expect((await confirmRoute(new Request("http://x/api/notify/confirm", { method: "POST" }))).status).toBe(400);
    const rows = await sql`select 1 from confirmed_addresses where email like ${`%@${DOMAIN}`} and email not in (${OWNER}, ${WAITER})`;
    expect(rows).toHaveLength(0);
  });

  it("asks a waitlist address to confirm before any date mail", async () => {
    const w = `curious@${DOMAIN}`;
    await sql`insert into interest (email, source) values (${w}, 'landing-waitlist')`;
    const { mails, mailer } = collect();
    const r = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(r.confirmations).toBe(1);
    expect(mails.filter((m) => m.to === w).map((m) => m.subject)).toEqual(["Confirm your address for aidep"]);
  });
});

describe("waitlist mail", () => {
  it("writes once per retirement date inside 14 days, to waitlist addresses only", async () => {
    await sql`insert into interest (email, source) values (${WAITER}, 'landing-waitlist')`;
    await sql`insert into interest (email, source) values (${WAITER}, 'landing-waitlist')`;
    await sql`insert into interest (email, source) values (${`buyer@${DOMAIN}`}, 'pricing-upgrade')`;
    const { mails, mailer } = collect();
    const r = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(r.waitlist).toBe(1);
    const w = mails.filter((m) => m.to === WAITER);
    expect(w).toHaveLength(1);
    expect(w[0].subject).toBe("assistants-api on 2026-08-26 (10 days)");
    expect(w[0].text).toContain("npx aidep .");
    expect(mails.some((m) => m.to === `buyer@${DOMAIN}`)).toBe(false);

    const again = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(again.waitlist).toBe(0);
  });

  it("sends nothing when no date is inside the window", async () => {
    await sql`insert into interest (email, source) values (${WAITER}, 'landing-waitlist')`;
    const { mails, mailer } = collect();
    const r = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: "2026-07-01" });
    expect(r.waitlist).toBe(0);
    expect(mails.some((m) => m.to === WAITER)).toBe(false);
  });
});

describe("unconfigured mail", () => {
  it("sends nothing and burns no ledger when Resend is not wired", async () => {
    const savedKey = process.env.RESEND_API_KEY;
    const savedFrom = process.env.MAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
    try {
      await sql`insert into interest (email, source) values (${WAITER}, 'landing-waitlist')`;
      await sql`delete from confirmed_addresses where email = ${WAITER}`;
      const r = await sendDueNotifications({ rows: MINI_REGISTRY, now: TODAY });
      expect(r).toEqual({ exposure: 0, waitlist: 0, confirmations: 0 });
      // the one-ever confirmation must not have been recorded against a no-op send
      const ledger = await sql`select 1 from notifications where recipient like ${`%@${DOMAIN}`}`;
      expect(ledger).toHaveLength(0);
    } finally {
      if (savedKey !== undefined) process.env.RESEND_API_KEY = savedKey;
      if (savedFrom !== undefined) process.env.MAIL_FROM = savedFrom;
    }
  });
});

describe("stop link", () => {
  const stop = (url: string) => stopRoute(new Request(url, { method: "POST" }));
  const suppressed = () =>
    sql<{ email: string }[]>`select email from suppressed_addresses where email like ${`%@${DOMAIN}`}`;

  it("suppresses on a valid token and refuses a forged one", async () => {
    expect((await stop(stopUrl(OWNER))).status).toBe(200);
    const forged = new URL(stopUrl(WAITER));
    forged.searchParams.set("t", "forged-token");
    expect((await stop(forged.toString())).status).toBe(400);
    expect((await stopPage(new Request(forged))).status).toBe(400);
    expect((await suppressed()).map((r) => r.email)).toEqual([OWNER]);
  });

  it("fetching the link shows one button and stops nothing; the mail client's one-click POST stops", async () => {
    const page = await stopPage(new Request(stopUrl(OWNER)));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain('<form method="post">');
    expect(await suppressed()).toHaveLength(0);

    const oneClick = await stopRoute(
      new Request(stopUrl(OWNER), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(oneClick.status).toBe(200);
    expect((await suppressed()).map((r) => r.email)).toEqual([OWNER]);
  });

  it("a suppressed address gets nothing, confirmed or not", async () => {
    await stop(stopUrl(OWNER)); // confirmed notify address
    await sql`delete from confirmed_addresses where email = ${WAITER}`;
    await stop(stopUrl(WAITER)); // unconfirmed waitlist address
    await sql`insert into interest (email, source) values (${WAITER}, 'landing-waitlist')`;
    const { mails, mailer } = collect();
    const r = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(r).toEqual({ exposure: 0, waitlist: 0, confirmations: 0 });
    expect(mails).toHaveLength(0);
  });

  it("every outbound mail, the confirmation included, carries the stop link and the one-click headers", async () => {
    await sql`insert into interest (email, source) values (${WAITER}, 'landing-waitlist')`;
    await sql`delete from confirmed_addresses where email = ${WAITER}`;
    const { mails, mailer } = collect();
    await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(mails.map((m) => m.subject.startsWith("Confirm")).sort()).toEqual([false, true]);
    for (const m of mails) {
      const stop = `/api/notify/stop?e=${encodeURIComponent(m.to)}`;
      expect(m.text, m.subject).toContain(stop);
      expect(m.headers?.["List-Unsubscribe"], m.subject).toBe(`<${stopUrl(m.to)}>`);
      expect(m.headers?.["List-Unsubscribe-Post"], m.subject).toBe("List-Unsubscribe=One-Click");
    }
  });
});

describe("confirmation cap", () => {
  it("sends at most 25 confirmations a run and the rest on the next", async () => {
    await sql`
      insert into interest (source, email)
      select 'landing-waitlist', 'w' || g || '@' || ${DOMAIN} from generate_series(1, 27) g`;
    const { mails, mailer } = collect();
    const first = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(first.confirmations).toBe(25);
    expect(mails.filter((m) => m.subject.startsWith("Confirm"))).toHaveLength(25);
    const second = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(second.confirmations).toBe(2);
    expect(new Set(mails.map((m) => m.to)).size).toBe(28); // 27 waiters plus the owner's digest
  });
});

describe("confirm response", () => {
  it("tells a waitlist address about dates, a notify address about the config file", async () => {
    const w = `curious@${DOMAIN}`;
    await sql`insert into interest (email, source) values (${w}, 'landing-waitlist')`;
    const waitlist = await confirmRoute(new Request(confirmUrl(w), { method: "POST" }));
    expect(await waitlist.text()).toBe(
      `Confirmed. aidep will write to ${w} when a retirement date is inside 14 days, and for nothing else. Every mail links to a stop button.\n`,
    );
    const notify = await (await confirmRoute(new Request(confirmUrl(OWNER), { method: "POST" }))).text();
    expect(notify).toContain("when a scan finds a new exposure or a retirement date gets close, and for nothing else. Remove the address from .github/aidep.json to stop");
    expect(notify).not.toContain("inside 14 days");
  });
});

describe("upgrade alert", () => {
  const intent = (email: string) => sql`insert into interest (source, email) values ('pricing-upgrade', ${email})`;

  it("one mail an hour, counting every intent since the last one", async () => {
    await intent(`a@${DOMAIN}`);
    await intent(`b@${DOMAIN}`);
    const { mails, mailer } = collect();
    expect(await upgradeAlert(mailer)).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("aidep: 2 upgrade intents");
    expect(mails[0].text).toContain(`since launch.\n\na@${DOMAIN}\nb@${DOMAIN}\n`);

    await intent(`c@${DOMAIN}`);
    expect(await upgradeAlert(mailer)).toBe(false);
    expect(mails).toHaveLength(1);

    // the hour turns: the slot frees, and only the intent since the last mail is reported
    await sql`update notifications set subject_key = 'earlier' where kind = 'operator'`;
    expect(await upgradeAlert(mailer)).toBe(true);
    expect(mails[1].subject).toBe("aidep: 1 upgrade intent");
    expect(mails[1].text).toContain(`\n\nc@${DOMAIN}\n`);
    expect(mails[1].text).not.toContain(`a@${DOMAIN}`);

    expect(await upgradeAlert(mailer)).toBe(false);
    expect(mails).toHaveLength(2);
  });

  it("the cron drain flushes an intent that missed its hour's mail", async () => {
    await intent(`a@${DOMAIN}`);
    const { mails, mailer } = collect();
    await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(mails.map((m) => m.subject)).toContain("aidep: 1 upgrade intent");
  });
});

describe("confirmation timing", () => {
  it("asks a waitlist signup to confirm even when nothing dies soon", async () => {
    await sql`delete from confirmed_addresses where email = ${WAITER}`;
    await sql`insert into interest (email, source) values (${WAITER}, 'landing-waitlist')`;
    const { mails, mailer } = collect();
    // 2026-07-01: no MINI_REGISTRY date inside the 14-day window
    const r = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: "2026-07-01" });
    expect(r.confirmations).toBe(1);
    expect(mails.some((m) => m.to === WAITER && m.subject.startsWith("Confirm"))).toBe(true);
  });
});
