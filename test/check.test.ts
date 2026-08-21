import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/check/route.ts";

describe("key check route", () => {
  const get = (auth?: string) =>
    GET(new Request("http://localhost/api/check", { headers: auth ? { authorization: auth } : {} }));

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret-40";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_SEARCH_TOKEN;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.unstubAllGlobals();
  });

  it("rejects missing or wrong bearer, and everything when the secret is unset", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("Bearer wrong")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await get("Bearer cron-secret-40")).status).toBe(401);
  });

  it("reports both keys unset without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await get("Bearer cron-secret-40");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      anthropic: { ok: false, error: "ANTHROPIC_API_KEY is not set" },
      search: { ok: false, error: "GITHUB_SEARCH_TOKEN is not set" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces the upstream status when a key is rejected", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-bad";
    process.env.GITHUB_SEARCH_TOKEN = "ghp_bad";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("https://api.anthropic.com")
          ? new Response('{"error":{"type":"authentication_error"}}', { status: 401 })
          : new Response('{"message":"Bad credentials"}', { status: 401 }),
      ),
    );
    const body = await (await get("Bearer cron-secret-40")).json();
    expect(body.anthropic.ok).toBe(false);
    expect(body.anthropic.error).toMatch(/^anthropic 401: .*authentication_error/);
    expect(body.search.ok).toBe(false);
    expect(body.search.error).toMatch(/^github 401: .*Bad credentials/);
  });

  it("reports ok with a detail when both keys work", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-good";
    process.env.GITHUB_SEARCH_TOKEN = "ghp_good";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("https://api.anthropic.com")
          ? Response.json({ content: [{ type: "text", text: "ok" }] })
          : Response.json({ total_count: 16512 }),
      ),
    );
    expect(await (await get("Bearer cron-secret-40")).json()).toEqual({
      anthropic: { ok: true, detail: "ok" },
      search: { ok: true, detail: "16512 files match" },
    });
  });
});
