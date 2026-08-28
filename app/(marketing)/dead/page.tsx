import type { Metadata } from "next";
import Link from "next/link";
import { findRow, rottedRows } from "../../../src/chain.ts";
import { listExposure, queryFor } from "../../../src/exposure.ts";
import { loadRegistry } from "../../../src/registry.ts";
import { chipClass, daysUntil, statusLabel } from "../dates.ts";
import { Kicker } from "../kicker.tsx";
import { installUrl } from "../site.ts";
import { applyFilters, type RegisterEntry } from "./filters.ts";
import { Lookup } from "./lookup.tsx";
import { Register } from "./register.tsx";

export const metadata: Metadata = {
  title: "The register · aidep",
  description:
    "Every retirement dated and sourced, GitHub code-search counts you can reproduce, and a lookup that walks any id to its fate.",
};

// Counts come from a daily snapshot, never from code search at request time.
export const revalidate = 3600;

export default async function DeadPage() {
  // listExposure defaults to 40; 500 covers every row that has ever been counted
  const [rows, counts] = await Promise.all([loadRegistry(), listExposure(500)]);
  const countById = new Map(counts.map((c) => [c.registry_id, c]));
  const now = new Date();

  const entries: RegisterEntry[] = rows.map((row) => {
    const count = countById.get(row.id);
    return {
      row,
      days: row.dies ? daysUntil(row.dies, now) : null,
      retired: row.status === "retired",
      query: count?.query ?? queryFor(row),
      files: count?.files ?? null,
      countedAt: count ? new Date(count.counted_at).toISOString() : null,
      rotted: row.replacement_id ? (findRow(rows, row.replacement_id) ?? null) : null,
    };
  });
  // "Already dead" means the provider retired it, not merely that a date
  // passed: Google's dates are earliest-possible, so a passed date there is
  // not proof the calls fail.
  const totalDeadFiles = entries.reduce((n, e) => n + (e.retired ? (e.files ?? 0) : 0), 0);
  // Newest count across every row: the top row's own stamp can be days older
  // than the freshest, and the page-level claim should not understate.
  const stamp =
    entries
      .map((e) => e.countedAt)
      .filter((s): s is string => s !== null)
      .sort()
      .at(-1)
      ?.slice(0, 10) ?? null;

  // What the lookup's placeholder types through: the nearest dying ids, then
  // the most recently retired. Real ids, so a stranger sees what to paste.
  const ordered = applyFilters(entries, { provider: "all", status: "all", sort: "dies", q: "" });
  const examples = [
    ...ordered.filter((e) => !e.retired && e.days !== null && e.days >= 0).slice(0, 3),
    ...ordered.filter((e) => e.retired).slice(0, 3),
  ].map((e) => e.row.api_ids[0]);

  // Sorted so the soonest-dying replacement is first; a replacement with no
  // date sorts last because nobody can act on it yet.
  const rotted = rottedRows(rows).sort((a, b) => {
    if (a.replacement.dies === b.replacement.dies) return a.row.id < b.row.id ? -1 : 1;
    if (a.replacement.dies === null) return 1;
    if (b.replacement.dies === null) return -1;
    return a.replacement.dies < b.replacement.dies ? -1 : 1;
  });

  return (
    <>
      <section>
        <div className="mx-auto max-w-6xl px-6 pb-20 pt-16">
          <p className="label text-ink-muted">
            {rows.length} deprecations tracked across openai, anthropic and google
            {stamp !== null && ` · latest count from github code search on ${stamp}`}
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl leading-[1.08] sm:text-5xl">
            {totalDeadFiles > 0
              ? `${totalDeadFiles.toLocaleString("en-US")} public files still call an AI model that is already dead.`
              : "What is already dead, and what dies next."}
          </h1>
          <p className="mt-6 max-w-2xl leading-relaxed text-ink-secondary">
            Every counted row below is one GitHub code search query. Paste it into GitHub and you should
            get the same number we did. A row marked not counted has no id distinctive enough to search
            for, or has not been counted yet. Nothing here needs an install, an account, or your code.
          </p>
        </div>
      </section>

      <section id="check" className="border-t border-rule">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Kicker>check an id</Kicker>
          <h2 className="mt-4 text-3xl sm:text-4xl">Paste what your agent picked</h2>
          <p className="mt-6 max-w-2xl leading-relaxed text-ink-secondary">
            A model id, an endpoint, or a param. The chain follows each announced replacement until it
            reaches something the vendor has not retired. Runs in your browser against{" "}
            <Link href="/api/registry" className="text-ink underline underline-offset-4">
              /api/registry
            </Link>
            , the same JSON any agent can read.
          </p>
          <div className="mt-8 max-w-2xl">
            <Lookup examples={examples} />
          </div>
        </div>
      </section>

      <section className="border-t border-rule">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Kicker>the register</Kicker>
          <h2 className="mt-4 text-3xl sm:text-4xl">Every row, with the query behind its number</h2>
          <div className="mt-8">
            <Register entries={entries} />
          </div>
        </div>
      </section>

      <section className="border-t border-rule">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Kicker>rotted replacements</Kicker>
          <h2 className="mt-4 text-3xl sm:text-4xl">Every replacement that is already dying</h2>
          <p className="mt-6 max-w-2xl leading-relaxed text-ink-secondary">
            Computed from the registry at render time, never typed in. Each date links to the vendor
            page it came from.
          </p>
          <div className="panel mt-8 overflow-x-auto">
            <table className="w-full min-w-[680px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[26%]" />
                <col className="w-[28%]" />
                <col />
              </colgroup>
              <thead>
                <tr className="label border-b border-rule text-left text-ink-muted">
                  <th className="px-4 py-2.5 font-normal">dead or dying</th>
                  <th className="px-4 py-2.5 font-normal">vendor says use</th>
                  <th className="px-4 py-2.5 font-normal">which is</th>
                  <th className="px-4 py-2.5 font-normal">source</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                {rotted.map(({ row, replacement }) => {
                  const days = replacement.dies ? daysUntil(replacement.dies, now) : null;
                  const retired = replacement.status === "retired";
                  return (
                    <tr key={row.id} className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                      <td className={row.status === "retired" ? "struck break-words px-4 py-3" : "break-words px-4 py-3 text-ink"}>
                        {row.api_ids[0]}
                      </td>
                      <td className={retired ? "struck break-words px-4 py-3" : "break-words px-4 py-3 text-ink"}>
                        {row.replacement_id}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`label inline-block whitespace-nowrap px-1.5 py-0.5 ${chipClass(days, retired)}`}
                        >
                          {statusLabel(replacement, days)}
                        </span>
                        {replacement.dies_is_earliest_possible && !retired && (
                          <span className="label ml-2 whitespace-nowrap text-ink-muted">earliest possible</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={replacement.source_url}
                          className="label text-ink-muted underline decoration-rule-strong underline-offset-2 hover:text-ink"
                        >
                          {new URL(replacement.source_url).hostname}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="border-t border-rule">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
            {stamp !== null &&
              `The latest count is from GitHub code search on ${stamp}; each files cell carries its own date. `}
            Code search indexes a subset of public code and counts files, not repos or calls, so treat
            these as a floor. Private code is not counted at all, which is where most of it lives.
          </p>
          <h2 className="mt-12 text-3xl sm:text-4xl">Find these in your repo, then merge the PR</h2>
          <p className="mt-6 max-w-2xl leading-relaxed text-ink-secondary">
            aidep finds these in your own repo, opens the migration PR, and proves the behavior held
            with an eval run in your CI.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={installUrl()} className="btn px-5 py-3">
              install on github →
            </a>
            <Link href="/#after-install" className="btn btn-outline px-5 py-3">
              how the PR works →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
