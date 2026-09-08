import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../tools/recount.ts", import.meta.url));

// The script hits api.github.com through the global fetch; a preload swaps
// that global for canned bodies, one per query in order.
const preload = `
const bodies = JSON.parse(process.env.RECOUNT_BODIES);
let i = 0;
globalThis.fetch = async () => new Response(JSON.stringify(bodies[i++]));
`;

describe("tools/recount.ts", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "aidep-recount-"));
    writeFileSync(join(tmp, "preload.mjs"), preload);
    mkdirSync(join(tmp, "evidence/recount"), { recursive: true });
    writeFileSync(
      join(tmp, "evidence/recount/2026-08-28.json"),
      JSON.stringify({
        date: "2026-08-28",
        queries: [
          { query: "client.beta.threads", files: 16448 },
          { query: "client.beta.assistants", files: 12384 },
        ],
      }),
    );
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const run = (bodies: unknown[]) =>
    spawnSync(process.execPath, ["--import", join(tmp, "preload.mjs"), script], {
      cwd: tmp,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        SEARCH_TOKEN: "t",
        RECOUNT_BODIES: JSON.stringify(bodies),
      },
      encoding: "utf8",
    });

  const today = new Date().toISOString().slice(0, 10);

  it("refuses a truncated search instead of writing the partial count", () => {
    const r = run([{ total_count: 227, incomplete_results: true }]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("incomplete_results");
    expect(existsSync(join(tmp, `evidence/recount/${today}.json`))).toBe(false);
  });

  it("refuses a count that moves more than half from the latest committed file, naming both", () => {
    const r = run([{ total_count: 227, incomplete_results: false }]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("227");
    expect(r.stderr).toContain("16448");
    expect(r.stderr).toContain("2026-08-28.json");
    expect(existsSync(join(tmp, `evidence/recount/${today}.json`))).toBe(false);
  });

  it(
    "writes a count that stays within half of the latest committed file",
    () => {
      const r = run([
        { total_count: 16400, incomplete_results: false },
        { total_count: 12300, incomplete_results: false },
      ]);
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(join(tmp, `evidence/recount/${today}.json`))).toBe(true);
    },
    // the script waits seven seconds between its two searches
    15_000,
  );
});
