import type { Metadata } from "next";
import Link from "next/link";
import { rottedRows } from "../../../src/chain.ts";
import { loadRegistry } from "../../../src/registry.ts";
import { chipClass, daysUntil, statusLabel } from "../dates.ts";
import { Lookup } from "./lookup.tsx";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Check what your AI picked · aidep",
  description:
    "Paste the replacement model your agent suggested and see whether it is already deprecated. One in six registry replacements is.",
};

export default async function ReplacementsPage() {
  const rows = await loadRegistry();
  const now = new Date();
  const withReplacement = rows.filter((r) => r.replacement_id !== null);
  // Sorted so the soonest-dying replacement is first; a replacement with no
  // date sorts last because nobody can act on it yet.
  const rotted = rottedRows(rows).sort((a, b) => {
    if (a.replacement.dies === b.replacement.dies) return a.row.id < b.row.id ? -1 : 1;
    if (a.replacement.dies === null) return 1;
    if (b.replacement.dies === null) return -1;
    return a.replacement.dies < b.replacement.dies ? -1 : 1;
  });

  return (
    <div className="mx-auto max-w-5xl px-6 pb-20 pt-16">
      <p className="text-xs uppercase tracking-widest text-ink-muted">
        {rows.length} deprecations tracked across OpenAI, Anthropic, and Google
      </p>
      <h1 className="mt-5 max-w-3xl text-4xl leading-[1.08] tracking-tight sm:text-5xl">
        Ask your AI what to migrate to. Then check what it said.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-secondary">
        Training cutoffs come before deprecations, by construction. A model asked to replace a dead id picks from what it
        learned months ago, and it will say &ldquo;done&rdquo; either way. Of the {withReplacement.length} registry rows
        that name a replacement, <span className="text-ink">{rotted.length}</span> name one that is itself already
        deprecated or retired.
      </p>

      <section className="mt-12 border-t border-rule pt-6">
        <h2 className="text-2xl">Check an id</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">
          A model id, an endpoint, or a param. The chain follows each announced replacement until it reaches something
          the vendor has not retired. Runs in your browser against{" "}
          <Link href="/api/registry" className="text-link underline">
            /api/registry
          </Link>
          , the same JSON any agent can read.
        </p>
        <div className="mt-6">
          <Lookup />
        </div>
      </section>

      <section className="mt-12 border-t border-rule pt-6">
        <h2 className="text-2xl">Every replacement that is already dying</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">
          Computed from the registry at render time, never typed in. Each date links to the vendor page it came from.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-rule text-xs uppercase tracking-wide text-ink-muted">
                <th className="py-2 pr-4 font-normal">Dead or dying</th>
                <th className="py-2 pr-4 font-normal">Vendor says use</th>
                <th className="py-2 pr-4 font-normal">Which is</th>
                <th className="py-2 font-normal">Source</th>
              </tr>
            </thead>
            <tbody>
              {rotted.map(({ row, replacement }) => {
                const days = replacement.dies ? daysUntil(replacement.dies, now) : null;
                const retired = replacement.status === "retired";
                return (
                  <tr key={row.id} className="border-b border-rule align-baseline">
                    <td className="py-3 pr-4">
                      <code className="text-ink">{row.api_ids[0]}</code>
                    </td>
                    <td className="py-3 pr-4">
                      <code className="text-ink">{row.replacement_id}</code>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-block px-2 py-0.5 text-xs ${chipClass(days, retired)}`}>
                        {statusLabel(replacement, days)}
                      </span>
                      {replacement.dies_is_earliest_possible && !retired && (
                        <span className="ml-2 text-xs text-ink-muted">earliest possible</span>
                      )}
                    </td>
                    <td className="py-3">
                      <a
                        href={replacement.source_url}
                        className="text-xs text-ink-muted underline decoration-rule underline-offset-2 hover:text-ink"
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
      </section>
    </div>
  );
}
