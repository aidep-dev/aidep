import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { POST } from "../app/api/interest/route.ts";

// a pricing-upgrade post reaches for Resend; keep this file's env unwired
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const DOMAIN = "interest.test";

const post = (body: { source: string; email?: string }) =>
  POST(
    new Request("http://localhost/api/interest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await sql.end();
});

afterEach(async () => {
  await sql`delete from interest where email like ${`%@${DOMAIN}`}`;
  await sql`delete from notifications where kind = 'operator'`;
});

describe("interest route", () => {
  it("stores the address lowercased and trimmed, and throttles on that form", async () => {
    expect((await post({ source: "landing-waitlist", email: `  Ada.Lovelace@Interest.TEST ` })).status).toBe(200);
    expect((await post({ source: "landing-waitlist", email: `ada.lovelace@${DOMAIN}` })).status).toBe(200);
    const rows = await sql<{ email: string }[]>`select email from interest where email like ${`%@${DOMAIN}`}`;
    expect(rows).toEqual([{ email: `ada.lovelace@${DOMAIN}` }]);
  });

  it("stores nothing past 60 rows an hour and still answers ok", async () => {
    await sql`
      insert into interest (source, email)
      select 'landing-waitlist', 'flood-' || g || '@' || ${DOMAIN} from generate_series(1, 61) g`;
    const res = await post({ source: "landing-waitlist", email: `late@${DOMAIN}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await sql`select 1 from interest where email = ${`late@${DOMAIN}`}`).toHaveLength(0);
  });

  it("stores an upgrade intent and, with mail unwired, claims no alert slot", async () => {
    expect((await post({ source: "pricing-upgrade", email: `buyer@${DOMAIN}` })).status).toBe(200);
    expect(await sql`select 1 from interest where email = ${`buyer@${DOMAIN}`} and source = 'pricing-upgrade'`).toHaveLength(1);
    expect(await sql`select 1 from notifications where kind = 'operator'`).toHaveLength(0);
  });
});
