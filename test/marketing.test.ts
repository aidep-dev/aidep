import { describe, expect, it } from "vitest";
import { daysLabel, daysUntil } from "../app/(marketing)/dates.ts";
import { applyFilters, type Filters, type RegisterEntry } from "../app/(marketing)/dead/filters.ts";
import type { RegistryRow } from "../src/registry.ts";

describe("countdown math", () => {
  it("counts whole days regardless of time of day", () => {
    expect(daysUntil("2026-08-26", new Date("2026-08-16T00:01:00Z"))).toBe(10);
    expect(daysUntil("2026-08-26", new Date("2026-08-16T23:59:00Z"))).toBe(10);
    expect(daysUntil("2026-08-16", new Date("2026-08-16T12:00:00Z"))).toBe(0);
    expect(daysUntil("2025-10-28", new Date("2026-08-16T12:00:00Z"))).toBeLessThan(0);
  });

  it("labels chips with text, never color alone", () => {
    expect(daysLabel(0)).toBe("calls fail today");
    expect(daysLabel(-30)).toBe("calls fail today");
    expect(daysLabel(1)).toBe("1 day");
    expect(daysLabel(10)).toBe("10 days");
  });
});

describe("landing mocks", () => {
  it("never hard-code the nearest retirement date", async () => {
    // 2026-08-25: the Step 01 mock shipped "nearest 2026-08-26 (5 days)" typed
    // by hand, and went stale on the shutdown day itself. Mock dates must be
    // derived from the registry like every other number on the page.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../app/(marketing)/page.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/nearest 20\d\d-/);
    expect(source).not.toMatch(/verified {2}20\d\d-/);
  });
});

describe("register filters", () => {
  function entry(id: string, over: Partial<RegistryRow> & { files?: number | null } = {}): RegisterEntry {
    const { files = null, ...rowOver } = over;
    const row: RegistryRow = {
      id: `openai:model:${id}`,
      provider: "openai",
      surface: "model",
      api_ids: [id],
      status: "deprecated",
      announced: null,
      dies: null,
      dies_is_earliest_possible: false,
      replacement_id: null,
      replacement_notes: null,
      migration_url: null,
      source_url: "https://platform.openai.com/docs/deprecations",
      verified_at: "2026-08-01",
      platform: "first-party",
      ...rowOver,
    };
    return { row, days: null, retired: row.status === "retired", query: null, files, countedAt: null, rotted: null };
  }
  const ALL: Filters = { provider: "all", status: "all", sort: "dies", q: "" };
  const ids = (xs: RegisterEntry[]) => xs.map((e) => e.row.api_ids[0]);

  const entries = [
    entry("live-late", { dies: "2027-01-01", files: 5 }),
    entry("live-soon", { dies: "2026-09-01" }),
    entry("live-undated", { files: 100 }),
    entry("dead-old", { status: "retired", dies: "2025-01-01", files: 40 }),
    entry("dead-new", { status: "retired", dies: "2026-06-01" }),
    entry("dead-undated", { status: "retired", api_ids: ["dead-undated", "Dead-Alias-2"], files: 40 }),
  ];

  it("partitions dead from dying on the retired flag", () => {
    expect(ids(applyFilters(entries, { ...ALL, status: "dead" }))).toEqual(["dead-new", "dead-old", "dead-undated"]);
    expect(ids(applyFilters(entries, { ...ALL, status: "dying" }))).toEqual(["live-soon", "live-late", "live-undated"]);
  });

  it("matches q against every api id, case-insensitively", () => {
    expect(ids(applyFilters(entries, { ...ALL, q: "dead-alias" }))).toEqual(["dead-undated"]);
    expect(ids(applyFilters(entries, { ...ALL, q: "LIVE-" }))).toEqual(["live-soon", "live-late", "live-undated"]);
  });

  it("sorts by dies: retired newest first, then live soonest first, dateless last", () => {
    expect(ids(applyFilters(entries, ALL))).toEqual([
      "dead-new",
      "dead-old",
      "dead-undated",
      "live-soon",
      "live-late",
      "live-undated",
    ]);
  });

  it("sorts by files descending with uncounted rows last", () => {
    expect(ids(applyFilters(entries, { ...ALL, sort: "files" }))).toEqual([
      "live-undated",
      "dead-old",
      "dead-undated",
      "live-late",
      "dead-new",
      "live-soon",
    ]);
  });
});
