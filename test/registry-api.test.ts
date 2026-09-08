import { afterEach, describe, expect, it, vi } from "vitest";
import { findRow, replacementChain, rottedRows } from "../src/chain.ts";
import { loadRegistry, RegistryRowSchema, type RegistryRow } from "../src/registry.ts";
import { MINI_REGISTRY } from "./mini-registry.ts";
import { GET as registryGet } from "../app/api/registry/route.ts";
import { GET as lookupGet } from "../app/api/registry/[...id]/route.ts";
import { GET as schemaGet } from "../app/api/registry/schema.json/route.ts";
import { GET as llmsGet } from "../app/llms.txt/route.ts";
import robots from "../app/robots.ts";
import nextConfig from "../next.config.ts";

const lookup = (...id: string[]) =>
  lookupGet(new Request(`http://localhost/api/registry/${id.join("/")}`), { params: Promise.resolve({ id }) });

describe("replacement chains", () => {
  it("walks ada to babbage-002 and stops at an id the registry does not have", () => {
    const c = replacementChain(MINI_REGISTRY, "ada");
    expect(c.hops.map((r) => r.api_ids[0])).toEqual(["ada", "babbage-002"]);
    expect(c.end).toEqual({ api_id: "gpt-4o-mini", known: false });
    expect(c.cycle).toBe(false);
  });

  it("returns no hops for an unknown id and names it as the end", () => {
    const c = replacementChain(MINI_REGISTRY, "not-a-model");
    expect(c.hops).toEqual([]);
    expect(c.end).toEqual({ api_id: "not-a-model", known: false });
  });

  it("terminates a cycle instead of looping", () => {
    const a = { ...MINI_REGISTRY[0], id: "openai:model:a", api_ids: ["a"], replacement_id: "b" };
    const b = { ...MINI_REGISTRY[0], id: "openai:model:b", api_ids: ["b"], replacement_id: "a" };
    const c = replacementChain([a, b] as RegistryRow[], "a");
    expect(c.hops.map((r) => r.api_ids[0])).toEqual(["a", "b"]);
    expect(c.cycle).toBe(true);
    expect(c.end).toBeNull();
  });

  it("prefers the model row when a feature row shares the api id", async () => {
    // the real registry carries babbage-002 twice: fine-tuning feature (retired 2024) and model (dies 2026)
    const rows = await loadRegistry();
    expect(findRow(rows, "babbage-002")?.id).toBe("openai:model:babbage-002");
  });

  it("lists every row whose replacement is itself a row", () => {
    const rotted = rottedRows(MINI_REGISTRY).map((x) => [x.row.api_ids[0], x.replacement.api_ids[0]]);
    expect(rotted).toEqual([["ada", "babbage-002"]]);
  });
});

describe("registry endpoints", () => {
  it("serves every row as one CORS-open array", async () => {
    const res = await registryGet();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const rows = (await res.json()) as RegistryRow[];
    expect(rows.length).toBe((await loadRegistry()).length);
    expect(() => RegistryRowSchema.parse(rows[0])).not.toThrow();
  });

  it("serves a JSON Schema with every row field", async () => {
    const schema = (await (await schemaGet()).json()) as { properties: Record<string, unknown>; $id: string };
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(RegistryRowSchema.shape).sort());
    expect(schema.$id).toBe("https://aidep.dev/api/registry/schema.json");
  });

  it("looks up a dead id and walks its chain", async () => {
    const res = await lookup("ada");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as { found: boolean; alive: boolean; chain: Array<{ api_id: string }> };
    expect(body.found).toBe(true);
    expect(body.alive).toBe(false);
    expect(body.chain.slice(0, 2).map((h) => h.api_id)).toEqual(["ada", "babbage-002"]);
  });

  it("reports a dying id as alive until its date", async () => {
    const body = (await (await lookup("gpt-4-turbo")).json()) as { alive: boolean; row: { dies: string } };
    expect(body.alive).toBe(true);
    expect(body.row.dies).toBe("2026-10-23");
  });

  it("resolves an endpoint id without its leading slash", async () => {
    const body = (await (await lookup("v1", "assistants")).json()) as { found: boolean; query: string };
    expect(body.found).toBe(true);
    expect(body.query).toBe("/v1/assistants");
  });

  it("404s an unknown id with a place to file it", async () => {
    const res = await lookup("not-a-model");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { found: boolean; query: string; file_a_row: string };
    expect(body.found).toBe(false);
    expect(body.query).toBe("not-a-model");
    expect(body.file_a_row).toMatch(/^https:\/\/github\.com\/aidep-dev\/aidep-registry/);
  });
});

describe("llms.txt", () => {
  it("follows the spec shape and only links places we serve", async () => {
    const text = await llmsGet().text();
    const lines = text.split("\n");
    expect(lines[0]).toBe("# aidep");
    expect(lines.find((l) => l.trim() !== "" && !l.startsWith("# "))).toMatch(/^> /);
    const links = lines.filter((l) => l.startsWith("- ["));
    expect(links.length).toBeGreaterThan(5);
    for (const l of links) {
      expect(l, l).toMatch(/^- \[[^\]]+\]\(https:\/\/(aidep\.dev|github\.com\/aidep-dev|www\.npmjs\.com\/package\/aidep)[^)]*\)/);
    }
    expect(text).toContain("/api/registry/gpt-4-turbo");
    expect(text).toContain("/dead");
    expect(text).toContain("/roadmap");
  });

  it("robots.txt lets crawlers fetch the registry API llms.txt points at, and nothing else under /api", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule.allow).toEqual(["/", "/api/registry"]);
    expect(rule.disallow).toEqual(["/dashboard", "/api/"]);
  });
});

describe("response headers", () => {
  it("hides X-Powered-By and sends the hygiene headers on every path", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const [all] = await nextConfig.headers!();
    expect(all.source).toBe("/:path*");
    expect(all.headers).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ]);
  });
});

describe("registry over https", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a non-2xx response instead of parsing its body, and sends a timeout signal", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(loadRegistry("https://registry.invalid/registry")).rejects.toThrow(/500/);
    expect(fetchSpy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
