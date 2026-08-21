import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AidepConfigSchema } from "../src/config.ts";
import { markOnboarded, sql, upsertInstallation, upsertRepo } from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { GET as confirmRoute } from "../app/api/notify/confirm/route.ts";
import { confirmAddress, confirmUrl, sendDueNotifications, type Mail, type Mailer } from "../src/notify.ts";
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
  await sql`delete from notifications where recipient like ${`%@${DOMAIN}`}`;
  await sql`delete from interest where email like ${`%@${DOMAIN}`}`;
  await sql`delete from confirmed_addresses where email like ${`%@${DOMAIN}`}`;
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
    expect(m.text).toContain("Remove it there to stop");

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

    const res = await confirmRoute(new Request(confirmUrl(NEW)));
    expect(res.status).toBe(200);
    const third = await sendDueNotifications({ mailer, rows: MINI_REGISTRY, now: TODAY });
    expect(third.exposure).toBe(1);
    expect(mails[1].to).toBe(NEW.toLowerCase());
    expect(mails[1].text).toContain("src/assist.py");
  });

  it("rejects a forged or mismatched token", async () => {
    const good = new URL(confirmUrl(NEW));
    const forged = new URL(good);
    forged.searchParams.set("t", good.searchParams.get("t")!.replace(/.$/, (c) => (c === "A" ? "B" : "A")));
    expect((await confirmRoute(new Request(forged))).status).toBe(400);
    const swapped = new URL(good);
    swapped.searchParams.set("e", `other@${DOMAIN}`);
    expect((await confirmRoute(new Request(swapped))).status).toBe(400);
    expect((await confirmRoute(new Request("http://x/api/notify/confirm"))).status).toBe(400);
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
