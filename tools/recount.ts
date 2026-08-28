#!/usr/bin/env node
/**
 * The Phase 1 recount (ROADMAP.md): how many public files still call the
 * OpenAI Assistants API on the days around its 2026-08-26 shutdown. The two
 * strings are the ones the 2026-08-18 baseline used (16,320 and 12,448), so
 * each run extends one series. No database: this writes a dated JSON file
 * into evidence/recount/ and the workflow commits it, so git dates the
 * numbers and the method travels with them.
 *
 *   GITHUB_SEARCH_TOKEN=... node tools/recount.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";

const QUERIES = ["client.beta.threads", "client.beta.assistants"];
const SearchResponse = z.object({ total_count: z.number().int().min(0) });
const OUT_DIR = "evidence/recount";

// In Actions the secret is SEARCH_TOKEN: secret names must not start with
// GITHUB_, which is why the original name could never be configured there.
const token = process.env.GITHUB_SEARCH_TOKEN ?? process.env.SEARCH_TOKEN;
if (token === undefined || token === "") {
  console.error("GITHUB_SEARCH_TOKEN/SEARCH_TOKEN is not set; code search needs an authenticated token.");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<{ query: string; files: number }> = [];

for (const [i, query] of QUERIES.entries()) {
  if (i > 0) await sleep(7000); // code search allows 10 requests a minute
  const res = await fetch(
    `https://api.github.com/search/code?q=${encodeURIComponent(`"${query}"`)}&per_page=1`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "aidep-recount",
      },
    },
  );
  // A failed request writes nothing: a missing file on a date is honest, a
  // zero on a date is a lie.
  if (!res.ok) {
    console.error(`code search failed for "${query}": ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const data = SearchResponse.safeParse(await res.json());
  if (!data.success) {
    console.error(`code search returned no total_count for "${query}"`);
    process.exit(1);
  }
  results.push({ query, files: data.data.total_count });
}

const countedAt = new Date().toISOString();
const date = countedAt.slice(0, 10);
const record = {
  date,
  counted_at: countedAt,
  method:
    'GET https://api.github.com/search/code?q="<query>"&per_page=1 with a classic token, total_count as returned, one request per query, seven seconds apart. Same strings as the 2026-08-18 baseline in ROADMAP.md.',
  queries: results,
};
await mkdir(OUT_DIR, { recursive: true });
const path = `${OUT_DIR}/${date}.json`;
await writeFile(path, JSON.stringify(record, null, 2) + "\n");
for (const r of results) console.log(`${r.query}\t${r.files}`);
console.log(`wrote ${path}`);
