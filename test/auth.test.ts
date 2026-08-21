import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, upsertInstallation, upsertRepo } from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { SESSION_COOKIE, openSession, sealSession } from "../src/auth/session.ts";
import { STATE_COOKIE, cookieHeader } from "../src/auth/access.ts";

// The migrate route imports the pipeline for its post-response drain; keep it
// inert here (same seam as handlers.test.ts).
// migrationCapBlock is real work (registry + a count query); these tests are
// about auth and enqueueing, so it is stubbed open here. The cap itself is
// covered end to end in migration.test.ts.
vi.mock("../src/pipeline.ts", () => ({
  runJob: vi.fn(async () => {}),
  migrationCapBlock: vi.fn(async () => null),
}));

process.env.GITHUB_CLIENT_ID = "test-client";
process.env.GITHUB_CLIENT_SECRET = "test-secret";
process.env.SESSION_SECRET = "test-session-secret";
process.env.APP_URL = "http://localhost:3000";

// id ranges owned by this file (installations 60xx, repos 61xx); other test
// files run in parallel against the same database.
const INST_OK = 6001;
const INST_UNPAID = 6002;
const INST_OTHER = 6003;
const REPO_PUBLIC = 6101;
const REPO_PRIVATE = 6102;
const REPO_FOREIGN = 6103;
const INTEREST_EMAIL = "auth-test-60xx@example.com";

const REGISTRY_ID = "openai:model:gpt-4";

function sessionCookie(userId: number): string {
  return `${SESSION_COOKIE}=${sealSession({ login: `u${userId}`, userId, token: `tok-${userId}` })}`;
}

/** Stub global fetch with the GitHub endpoints the auth code calls. */
function stubGithub(installationIds: number[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        return Response.json({ access_token: "gho_test" });
      }
      if (url.startsWith("https://api.github.com/user/installations")) {
        return Response.json({ installations: installationIds.map((id) => ({ id })) });
      }
      if (url.startsWith("https://api.github.com/user")) {
        return Response.json({ login: "octocat", id: 42 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await sql`delete from interest where email = ${INTEREST_EMAIL}`;
  await sql.end();
});

beforeEach(async () => {
  await sql`delete from installations where id between 6000 and 6999`;
  await sql`delete from jobs where (payload->>'repoId')::bigint between 6100 and 6199`;
  await sql`delete from interest where email = ${INTEREST_EMAIL}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session seal/open", () => {
  it("round trips", () => {
    const s = { login: "octocat", userId: 42, token: "gho_x" };
    expect(openSession(sealSession(s))).toEqual(s);
  });

  it("returns null on a tampered cookie", () => {
    const sealed = sealSession({ login: "octocat", userId: 42, token: "gho_x" });
    const raw = Buffer.from(sealed, "base64url");
    raw[raw.length - 1] ^= 0xff; // flip a byte in the ciphertext
    expect(openSession(raw.toString("base64url"))).toBeNull();
  });
});

describe("oauth callback", () => {
  async function callback(query: string, cookie?: string): Promise<Response> {
    const { GET } = await import("../app/api/auth/callback/route.ts");
    return GET(
      new Request(`http://localhost/api/auth/callback${query}`, {
        headers: cookie ? { cookie } : {},
      }),
    );
  }

  it("rejects a state mismatch with 401", async () => {
    stubGithub([]);
    expect((await callback("?code=c1&state=aaa", `${STATE_COOKIE}=bbb`)).status).toBe(401);
    expect((await callback("?code=c1&state=aaa")).status).toBe(401); // no cookie at all
  });

  it("happy path: exchanges the code, seals a session, redirects to /dashboard", async () => {
    stubGithub([]);
    const res = await callback("?code=c1&state=abc", `${STATE_COOKIE}=abc`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
    const setCookies = res.headers.getSetCookie();
    const sessionSet = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sessionSet).toContain("HttpOnly");
    expect(sessionSet).toContain("SameSite=Lax");
    const sealed = sessionSet!.split(";")[0].slice(SESSION_COOKIE.length + 1);
    expect(openSession(sealed)).toEqual({ login: "octocat", userId: 42, token: "gho_test" });
    // state cookie cleared
    expect(setCookies.find((c) => c.startsWith(`${STATE_COOKIE}=`))).toContain("Max-Age=0");
  });
});

describe("migrate route", () => {
  async function post(repoId: number, cookie?: string, registryId: string = REGISTRY_ID): Promise<Response> {
    const { POST } = await import("../app/api/repos/[repoId]/migrate/route.ts");
    return POST(
      new Request(`http://localhost/api/repos/${repoId}/migrate`, {
        method: "POST",
        headers: cookie
          ? { "content-type": "application/json", cookie }
          : { "content-type": "application/json" },
        body: JSON.stringify({ registryId }),
      }),
      { params: Promise.resolve({ repoId: String(repoId) }) },
    );
  }

  it("401 without a session cookie", async () => {
    expect((await post(REPO_PUBLIC)).status).toBe(401);
  });

  it("400 on a registryId that fails the schema", async () => {
    const res = await post(REPO_PUBLIC, sessionCookie(7000), "not a registry id");
    expect(res.status).toBe(400);
  });

  it("403 when the user's installations do not include the repo's", async () => {
    await upsertInstallation(INST_OTHER, "someone-else");
    await upsertRepo({ id: REPO_FOREIGN, installationId: INST_OTHER, owner: "someone-else", name: "r", defaultBranch: "main" });
    stubGithub([999]); // user can see installation 999 only
    expect((await post(REPO_FOREIGN, sessionCookie(7003))).status).toBe(403);
  });

  it("migration PRs are free on a private repo whose installation is unpaid", async () => {
    // The paid line is the eval pack (gated in evalPackFor), never the PR.
    await upsertInstallation(INST_UNPAID, "acme"); // paid defaults to false
    await upsertRepo({ id: REPO_PRIVATE, installationId: INST_UNPAID, owner: "acme", name: "priv", defaultBranch: "main", private: true });
    stubGithub([INST_UNPAID]);
    const res = await post(REPO_PRIVATE, sessionCookie(7002));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enqueued: true });
    const jobs = await sql`
      select 1 from jobs
      where type = 'create_migration_pr' and status = 'queued'
        and (payload->>'repoId')::bigint = ${REPO_PRIVATE}`;
    expect(jobs).toHaveLength(1);
  });

  it("200 on a public repo enqueues create_migration_pr", async () => {
    await upsertInstallation(INST_OK, "acme");
    await upsertRepo({ id: REPO_PUBLIC, installationId: INST_OK, owner: "acme", name: "pub", defaultBranch: "main" });
    stubGithub([INST_OK]);
    const res = await post(REPO_PUBLIC, sessionCookie(7001));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enqueued: true });
    const jobs = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from jobs
      where type = 'create_migration_pr' and status = 'queued'
        and (payload->>'repoId')::bigint = ${REPO_PUBLIC}`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ repoId: REPO_PUBLIC, registryId: REGISTRY_ID });
  });
});

describe("interest route", () => {
  it("validates and inserts a signal row", async () => {
    const { POST } = await import("../app/api/interest/route.ts");
    const res = await POST(
      new Request("http://localhost/api/interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "private-gate", email: INTEREST_EMAIL, context: "repo 6102" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await sql`select source, context from interest where email = ${INTEREST_EMAIL}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "private-gate", context: "repo 6102" });

    const bad = await POST(
      new Request("http://localhost/api/interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "made-up-source" }),
      }),
    );
    expect(bad.status).toBe(400);
  });

  it("rejects an invalid email with 400", async () => {
    const { POST } = await import("../app/api/interest/route.ts");
    const res = await POST(
      new Request("http://localhost/api/interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "private-gate", email: "not-an-email" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("throttles a duplicate signal within the window to one row", async () => {
    const { POST } = await import("../app/api/interest/route.ts");
    const send = () =>
      POST(
        new Request("http://localhost/api/interest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "landing-waitlist", email: INTEREST_EMAIL }),
        }),
      );
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const rows = await sql`select 1 from interest where email = ${INTEREST_EMAIL}`;
    expect(rows).toHaveLength(1);
  });
});

describe("requireRepoAccess", () => {
  it("re-checks GitHub every call; access revoked between calls is denied on the second", async () => {
    const { requireRepoAccess } = await import("../src/auth/access.ts");
    await upsertInstallation(INST_OK, "acme");
    await upsertRepo({ id: REPO_PUBLIC, installationId: INST_OK, owner: "acme", name: "pub", defaultBranch: "main" });
    const session = { login: "u7100", userId: 7100, token: "tok-7100" };

    stubGithub([INST_OK]);
    const first = await requireRepoAccess(session, REPO_PUBLIC);
    expect(first.allowed).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    stubGithub([]); // installation access revoked at GitHub; fresh mock, count resets
    const second = await requireRepoAccess(session, REPO_PUBLIC);
    expect(second.allowed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1); // hit GitHub again, not a cached answer
  });

  it("rejects a non-positive-integer repoId without a GitHub call", async () => {
    const { requireRepoAccess } = await import("../src/auth/access.ts");
    stubGithub([INST_OK]);
    const r = await requireRepoAccess({ login: "u", userId: 1, token: "t" }, Number("abc"));
    expect(r).toEqual({ repo: null, allowed: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("cookieHeader Secure flag", () => {
  it("adds Secure in production even when APP_URL is not https", () => {
    // APP_URL is http://localhost:3000 in this suite, so only the prod guard can add Secure.
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(cookieHeader("aidep_session", "v", 60)).toContain("; Secure");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("omits Secure on http outside production", () => {
    expect(cookieHeader("aidep_session", "v", 60)).not.toContain("; Secure");
  });
});
