import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { markOnboarded, sql, upsertInstallation, upsertRepo } from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import {
  SESSION_COOKIE,
  getUserAccess,
  getUserInstallationRepoIds,
  openSession,
  sealSession,
} from "../src/auth/session.ts";
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

/**
 * Stub global fetch with the GitHub endpoints the auth code calls. `access`
 * maps each installation the user can see to the repo ids they can read in
 * it; an installation missing from the map is a 404, as GitHub answers.
 */
function stubGithub(access: Record<number, number[]>, exchange: unknown = { access_token: "gho_test" }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        return Response.json(exchange);
      }
      const repos = url.match(/\/user\/installations\/(\d+)\/repositories/);
      if (repos) {
        const ids = access[Number(repos[1])];
        if (!ids) return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json({ repositories: ids.map((id) => ({ id })) });
      }
      if (url.startsWith("https://api.github.com/user/installations")) {
        return Response.json({ installations: Object.keys(access).map((id) => ({ id: Number(id) })) });
      }
      if (url.startsWith("https://api.github.com/user")) {
        return Response.json({ login: "octocat", id: 42 });
      }
      if (url.startsWith("https://api.github.com/applications/")) {
        return new Response(null, { status: 204 });
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
  it("round trips, stamping the issue time", () => {
    const s = { login: "octocat", userId: 42, token: "gho_x" };
    expect(openSession(sealSession(s))).toEqual({ ...s, iat: expect.any(Number) });
  });

  it("refuses a seal older than seven days whatever the cookie's Max-Age says", () => {
    vi.useFakeTimers({ now: new Date("2026-08-01T00:00:00Z") });
    try {
      const sealed = sealSession({ login: "octocat", userId: 42, token: "gho_x" });
      vi.setSystemTime(new Date("2026-08-07T23:00:00Z"));
      expect(openSession(sealed)).not.toBeNull();
      vi.setSystemTime(new Date("2026-08-08T00:00:01Z"));
      expect(openSession(sealed)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
    stubGithub({});
    expect((await callback("?code=c1&state=aaa", `${STATE_COOKIE}=bbb`)).status).toBe(401);
    expect((await callback("?code=c1&state=aaa")).status).toBe(401); // no cookie at all
  });

  it("happy path: exchanges the code, seals a session, redirects to /dashboard", async () => {
    stubGithub({});
    const res = await callback("?code=c1&state=abc", `${STATE_COOKIE}=abc`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
    const setCookies = res.headers.getSetCookie();
    const sessionSet = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sessionSet).toContain("HttpOnly");
    expect(sessionSet).toContain("SameSite=Lax");
    const sealed = sessionSet!.split(";")[0].slice(SESSION_COOKIE.length + 1);
    expect(openSession(sealed)).toMatchObject({ login: "octocat", userId: 42, token: "gho_test" });
    // state cookie cleared
    expect(setCookies.find((c) => c.startsWith(`${STATE_COOKIE}=`))).toContain("Max-Age=0");
  });

  it("Cancel at GitHub (?error=access_denied) goes home and drops the state cookie", async () => {
    stubGithub({});
    const res = await callback("?error=access_denied&state=abc", `${STATE_COOKIE}=abc`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?auth=denied");
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.find((c) => c.startsWith(`${STATE_COOKIE}=`))).toContain("Max-Age=0");
    expect(setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBeUndefined();
  });

  it("a stale or reused code goes home instead of throwing", async () => {
    stubGithub({}, { error: "bad_verification_code" });
    const res = await callback("?code=used&state=abc", `${STATE_COOKIE}=abc`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?auth=denied");
    expect(res.headers.getSetCookie().find((c) => c.startsWith(`${STATE_COOKIE}=`))).toContain("Max-Age=0");
  });
});

describe("logout", () => {
  async function logout(cookie?: string): Promise<Response> {
    const { POST } = await import("../app/api/auth/logout/route.ts");
    return POST(new Request("http://localhost/api/auth/logout", { method: "POST", headers: cookie ? { cookie } : {} }));
  }

  it("revokes the GitHub token with the App's client credentials, then clears the cookie", async () => {
    stubGithub({});
    const res = await logout(sessionCookie(7010));
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=; `);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/applications/test-client/token");
    expect(init.method).toBe("DELETE");
    const basic = Buffer.from("test-client:test-secret").toString("base64");
    expect(new Headers(init.headers).get("authorization")).toBe(`Basic ${basic}`);
    expect(JSON.parse(String(init.body))).toEqual({ access_token: "tok-7010" });
  });

  it("still signs out when GitHub is down or the token is already gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await logout(sessionCookie(7011))).status).toBe(302);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Unprocessable" }, { status: 422 })));
    expect((await logout(sessionCookie(7011))).status).toBe(302);
  });

  it("skips the revoke without a session", async () => {
    stubGithub({});
    expect((await logout()).status).toBe(302);
    expect(fetch).not.toHaveBeenCalled();
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
    stubGithub({ 999: [] }); // user can see installation 999 only
    expect((await post(REPO_FOREIGN, sessionCookie(7003))).status).toBe(403);
  });

  it("403 when the user sees the repo's installation but not that repo", async () => {
    // an outside collaborator on one repo of an org-wide install
    await upsertInstallation(INST_OK, "acme");
    await upsertRepo({ id: REPO_PUBLIC, installationId: INST_OK, owner: "acme", name: "pub", defaultBranch: "main" });
    await markOnboarded(REPO_PUBLIC, DEFAULT_CONFIG);
    stubGithub({ [INST_OK]: [REPO_PUBLIC + 50] });
    expect((await post(REPO_PUBLIC, sessionCookie(7004))).status).toBe(403);
  });

  it("migration PRs are free on a private repo whose installation is unpaid", async () => {
    // The paid line is the eval pack (gated in evalPackFor), never the PR.
    await upsertInstallation(INST_UNPAID, "acme"); // paid defaults to false
    await upsertRepo({ id: REPO_PRIVATE, installationId: INST_UNPAID, owner: "acme", name: "priv", defaultBranch: "main", private: true });
    await markOnboarded(REPO_PRIVATE, DEFAULT_CONFIG);
    stubGithub({ [INST_UNPAID]: [REPO_PRIVATE] });
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
    await markOnboarded(REPO_PUBLIC, DEFAULT_CONFIG);
    stubGithub({ [INST_OK]: [REPO_PUBLIC] });
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

  it("409 with a reason while the onboarding PR is unmerged, and nothing is enqueued", async () => {
    await upsertInstallation(INST_OK, "acme");
    await upsertRepo({ id: REPO_PUBLIC, installationId: INST_OK, owner: "acme", name: "pub", defaultBranch: "main" });
    stubGithub({ [INST_OK]: [REPO_PUBLIC] });
    const res = await post(REPO_PUBLIC, sessionCookie(7001));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("onboarding PR");
    const jobs = await sql`
      select 1 from jobs
      where type = 'create_migration_pr' and (payload->>'repoId')::bigint = ${REPO_PUBLIC}`;
    expect(jobs).toHaveLength(0);
  });
});

describe("interest route", () => {
  it("validates and inserts a signal row", async () => {
    const { POST } = await import("../app/api/interest/route.ts");
    const res = await POST(
      new Request("http://localhost/api/interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "landing-waitlist", email: INTEREST_EMAIL, context: "repo 6102" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await sql`select source, context from interest where email = ${INTEREST_EMAIL}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "landing-waitlist", context: "repo 6102" });

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
  const session = { login: "u7100", userId: 7100, token: "tok-7100", iat: Date.now() };

  it("re-checks GitHub every call; access revoked between calls is denied on the second", async () => {
    const { requireRepoAccess } = await import("../src/auth/access.ts");
    await upsertInstallation(INST_OK, "acme");
    await upsertRepo({ id: REPO_PUBLIC, installationId: INST_OK, owner: "acme", name: "pub", defaultBranch: "main" });

    stubGithub({ [INST_OK]: [REPO_PUBLIC] });
    const first = await requireRepoAccess(session, REPO_PUBLIC);
    expect(first.allowed).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    stubGithub({}); // installation access revoked at GitHub; fresh mock, count resets
    const second = await requireRepoAccess(session, REPO_PUBLIC);
    expect(second.allowed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1); // hit GitHub again, not a cached answer
  });

  it("denies a repo the user cannot read even though they can see its installation", async () => {
    const { requireRepoAccess } = await import("../src/auth/access.ts");
    await upsertInstallation(INST_OK, "acme");
    await upsertRepo({ id: REPO_PUBLIC, installationId: INST_OK, owner: "acme", name: "pub", defaultBranch: "main" });
    stubGithub({ [INST_OK]: [REPO_PUBLIC + 50] });
    expect((await requireRepoAccess(session, REPO_PUBLIC)).allowed).toBe(false);
  });

  it("rejects a non-positive-integer repoId without a GitHub call", async () => {
    const { requireRepoAccess } = await import("../src/auth/access.ts");
    stubGithub({ [INST_OK]: [REPO_PUBLIC] });
    const r = await requireRepoAccess(session, Number("abc"));
    expect(r).toEqual({ repo: null, allowed: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("what the user can see, per GitHub", () => {
  it("walks every page of an installation's repos", async () => {
    const pages: Record<string, number[]> = {
      "1": Array.from({ length: 100 }, (_, i) => 1000 + i),
      "2": [2000],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const page = new URL(String(input)).searchParams.get("page") ?? "1";
      return Response.json({ repositories: pages[page].map((id) => ({ id })) });
    });
    const ids = await getUserInstallationRepoIds("t", 6001, fetchImpl as typeof fetch);
    expect(ids).toHaveLength(101);
    expect(ids).toContain(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a 404 is an empty list; any other failure carries its status", async () => {
    const answer = (status: number) => vi.fn(async () => Response.json({}, { status })) as unknown as typeof fetch;
    expect(await getUserInstallationRepoIds("t", 6001, answer(404))).toEqual([]);
    await expect(getUserInstallationRepoIds("t", 6001, answer(503))).rejects.toMatchObject({ status: 503 });
    await expect(getUserInstallationRepoIds("t", 6001, answer(401))).rejects.toMatchObject({ status: 401 });
  });

  it("flattens the readable repos across installations", async () => {
    stubGithub({ [INST_OK]: [REPO_PUBLIC, REPO_PRIVATE], [INST_OTHER]: [REPO_FOREIGN] });
    expect(await getUserAccess("t")).toEqual({
      installationIds: [INST_OK, INST_OTHER],
      repoIds: [REPO_PUBLIC, REPO_PRIVATE, REPO_FOREIGN],
    });
  });
});

describe("githubFailure on a dashboard page", () => {
  it("only a 401 sends the user back to sign-in; everything else is a line on the page", async () => {
    const { githubFailure } = await import("../app/(dashboard)/auth.ts");
    const { GithubError } = await import("../src/auth/session.ts");
    expect(() => githubFailure(new GithubError(401, "user/installations"))).toThrow(/NEXT_REDIRECT/);
    expect(githubFailure(new GithubError(503, "user/installations"))).toContain("HTTP 503");
    expect(githubFailure(new GithubError(403, "user/installations"))).toContain("HTTP 403");
    expect(githubFailure(new TypeError("fetch failed"))).toContain("no response");
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
