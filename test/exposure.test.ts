import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import {
  distanceFromNow,
  IMPLAUSIBLE_FILE_COUNT,
  isSearchable,
  listExposure,
  queryFor,
  refreshExposure,
} from "../src/exposure.ts";
import type { RegistryRow } from "../src/registry.ts";

const NOW = new Date("2026-08-18T00:00:00Z");

function row(over: Partial<RegistryRow> & { id: string; api_ids: string[] }): RegistryRow {
  return {
    provider: "openai",
    surface: "model",
    status: "retired",
    announced: null,
    dies: "2026-01-01",
    dies_is_earliest_possible: false,
    replacement_id: null,
    replacement_notes: null,
    migration_url: null,
    source_url: "https://example.com/deprecations",
    verified_at: "2026-08-18",
    platform: "first-party",
    ...over,
  } as RegistryRow;
}

beforeAll(async () => {
  await migrate();
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`delete from exposure_counts where registry_id like 'test:%'`;
});

describe("isSearchable", () => {
  it("rejects bare English-word model ids", () => {
    // "ada" matched 572,522,496 files as an ordinary substring; publishing a
    // count against it would be noise dressed as evidence
    for (const id of ["ada", "babbage", "curie", "davinci"]) {
      expect(isSearchable(id), id).toBe(false);
    }
  });

  it("accepts version-shaped ids and API paths", () => {
    for (const id of [
      "claude-3-5-sonnet-20241022",
      "gpt-4o-2024-05-13",
      "gemini-2.0-flash-001",
      "babbage-002",
      "/v1/prompts",
      "client.beta.threads",
    ]) {
      expect(isSearchable(id), id).toBe(true);
    }
  });
});

describe("queryFor", () => {
  it("picks the first searchable api_id for a model", () => {
    expect(queryFor(row({ id: "openai:model:x", api_ids: ["ada", "code-davinci-002"] }))).toBe(
      "code-davinci-002",
    );
  });

  it("returns null when no api_id is distinctive enough to publish", () => {
    expect(queryFor(row({ id: "openai:model:ada", api_ids: ["ada"] }))).toBeNull();
  });

  it("uses one idiomatic call shape for an endpoint, never a sum", () => {
    const assistants = row({
      id: "openai:endpoint:assistants-api",
      surface: "endpoint",
      api_ids: ["client.beta.assistants", "client.beta.threads", "/v1/assistants"],
    });
    expect(queryFor(assistants)).toBe("client.beta.threads");
  });
});

describe("distanceFromNow", () => {
  it("ranks just-died and dying-soon above the distant past and future", () => {
    const near = distanceFromNow("2026-08-26", NOW); // 8 days out
    const old = distanceFromNow("2023-07-06", NOW);
    const far = distanceFromNow("2027-05-07", NOW);
    expect(near).toBeLessThan(old);
    expect(near).toBeLessThan(far);
    expect(distanceFromNow(null, NOW)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("refreshExposure", () => {
  const rows = [
    row({ id: "test:model:a", api_ids: ["test-model-a-001"], dies: "2026-08-20" }),
    row({ id: "test:model:b", api_ids: ["test-model-b-002"], dies: "2026-08-19" }),
  ];
  const opts = { token: "t", rows, now: NOW, sleep: async () => {} };

  it("stores counts and reads them back", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ total_count: 4321 }))) as unknown as typeof fetch;
    const r = await refreshExposure({ ...opts, fetchImpl });
    expect(r).toEqual({ updated: 2, skipped: 0 });
    const stored = (await listExposure()).filter((x) => x.registry_id.startsWith("test:"));
    expect(stored).toHaveLength(2);
    expect(stored[0].files).toBe(4321);
  });

  it("skips an implausible count rather than publishing a substring artifact", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ total_count: IMPLAUSIBLE_FILE_COUNT + 1 }),
      )) as unknown as typeof fetch;
    const r = await refreshExposure({ ...opts, fetchImpl });
    expect(r).toEqual({ updated: 0, skipped: 2 });
    expect((await listExposure()).filter((x) => x.registry_id.startsWith("test:"))).toHaveLength(0);
  });

  it("leaves the previous number standing when a request fails", async () => {
    const ok = (async () =>
      new Response(JSON.stringify({ total_count: 100 }))) as unknown as typeof fetch;
    await refreshExposure({ ...opts, fetchImpl: ok });
    const boom = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const r = await refreshExposure({ ...opts, fetchImpl: boom });
    expect(r).toEqual({ updated: 0, skipped: 2 });
    // a failed request must never be written as zero: zero reads as "nobody
    // is exposed", the opposite of what a failure means
    const stored = (await listExposure()).filter((x) => x.registry_id.startsWith("test:"));
    expect(stored.every((x) => x.files === 100)).toBe(true);
  });

  it("counts never-seen rows before re-counting stored ones", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ total_count: 7 }));
    }) as unknown as typeof fetch;
    await refreshExposure({ ...opts, fetchImpl, max: 1 });
    const first = asked.length;
    await refreshExposure({ ...opts, fetchImpl, max: 1 });
    // the second run must reach for the other row, not repeat the first
    expect(asked).toHaveLength(first + 1);
    expect(asked[0]).not.toBe(asked[1]);
  });
});
