import type { Metadata } from "next";
import Link from "next/link";
import { listExposure } from "../../../src/exposure.ts";
import { loadRegistry } from "../../../src/registry.ts";
import { daysLabel, daysUntil, formatDies } from "../dates.ts";

export const metadata: Metadata = {
  title: "What is already dead · aidep",
  description:
    "Public GitHub files still calling retired AI models and APIs, counted from code search. One query per row, so you can check every number yourself.",
};

// Counts come from a daily snapshot, never from code search at request time.
export const revalidate = 3600;

function chipClass(days: number | null, retired: boolean): string {
  if (retired) return "bg-dead-bg text-dead";
  if (days !== null && days <= 90) return "bg-dying-bg text-dying";
  return "text-ink-muted";
}

/**
 * Status text. A passed date is not the same as a dead model: Google publishes
 * "earliest possible" shutdown dates, so a row whose date has gone by may
 * still answer. Only the provider marking it retired means the calls fail.
 */
function statusLabel(row: { status: string; dies: string | null; dies_is_earliest_possible: boolean }, days: number | null): string {
  if (row.status === "retired") return row.dies ? `retired ${formatDies(row.dies)}` : "retired";
  if (days === null) return "no date announced";
  if (days <= 0) return row.dies_is_earliest_possible ? "past earliest date" : "calls fail today";
  return daysLabel(days);
}

export default async function DeadPage() {
  const [rows, counts] = await Promise.all([loadRegistry(), listExposure(40)]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = new Date();

  const listed = counts
    .map((c) => ({ count: c, row: byId.get(c.registry_id) }))
    .filter((x): x is { count: (typeof counts)[number]; row: NonNullable<typeof x.row> } =>
      Boolean(x.row),
    );

  // "Already dead" means the provider retired it, not merely that a date
  // passed: Google's dates are earliest-possible, so a passed date there is
  // not proof the calls fail.
  const dead = listed.filter((x) => x.row.status === "retired");
  const dying = listed.filter((x) => !dead.includes(x));
  const totalDeadFiles = dead.reduce((n, x) => n + x.count.files, 0);
  const stamped = counts[0]?.counted_at ? new Date(counts[0].counted_at) : null;

  return (
    <div className="mx-auto max-w-5xl px-6 pb-20 pt-16">
      <p className="text-xs uppercase tracking-widest text-ink-muted">
        {rows.length} deprecations tracked across OpenAI, Anthropic, and Google
      </p>
      <h1 className="mt-5 max-w-3xl text-4xl leading-[1.08] tracking-tight sm:text-5xl">
        {totalDeadFiles > 0
          ? `${totalDeadFiles.toLocaleString("en-US")} public files still call an AI model that is already dead.`
          : "What is already dead, and what dies next."}
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-secondary">
        Every row below is one GitHub code search query. Paste it into GitHub and you should get the
        same number we did. Nothing here needs an install, an account, or your code.
      </p>

      {listed.length === 0 ? (
        <p className="mt-12 max-w-2xl border-t border-rule pt-6 leading-relaxed text-ink-secondary">
          The counts have not been collected yet. The registry below is live either way: see{" "}
          <Link href="/" className="text-ink underline underline-offset-4">
            the front page
          </Link>{" "}
          for what dies next.
        </p>
      ) : (
        <>
          <Section
            title="Already dead"
            blurb="These calls fail today. Code pinning them is broken now, not later."
            items={dead}
            now={now}
          />
          <Section
            title="Dying next"
            blurb="Announced retirement dates. The date is when the calls start failing."
            items={dying}
            now={now}
          />
        </>
      )}

      <p className="mt-14 max-w-2xl border-t border-rule pt-4 text-xs leading-relaxed text-ink-muted">
        {stamped
          ? `Counts from GitHub code search on ${stamped.toISOString().slice(0, 10)}. `
          : ""}
        Code search indexes a subset of public code and counts files, not repos or calls, so treat
        these as a floor. Private code is not counted at all, which is where most of it lives.
      </p>

      <div className="mt-8 border-t border-rule pt-6">
        <p className="max-w-2xl leading-relaxed text-ink-secondary">
          aidep finds these in your own repo, opens the migration PR, and proves the behavior held
          with an eval run in your CI.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/85"
        >
          How it works
        </Link>
      </div>
    </div>
  );
}

function Section({
  title,
  blurb,
  items,
  now,
}: {
  title: string;
  blurb: string;
  items: Array<{ count: { query: string; files: number }; row: Awaited<ReturnType<typeof loadRegistry>>[number] }>;
  now: Date;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-12 border-t border-rule pt-6">
      <h2 className="text-2xl">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">{blurb}</p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-rule text-xs uppercase tracking-wide text-ink-muted">
              <th className="py-2 pr-4 font-normal">Search query</th>
              <th className="py-2 pr-4 font-normal">Files</th>
              <th className="py-2 pr-4 font-normal">Status</th>
              <th className="py-2 font-normal">Replacement</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ count, row }) => {
              const days = row.dies ? daysUntil(row.dies, now) : null;
              const retired = row.status === "retired";
              return (
                <tr key={row.id} className="border-b border-rule align-baseline">
                  <td className="py-3 pr-4">
                    <code className="text-ink">{count.query}</code>
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-ink">
                    {count.files.toLocaleString("en-US")}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`inline-block px-2 py-0.5 text-xs ${chipClass(days, retired)}`}>
                      {statusLabel(row, days)}
                    </span>
                    {row.dies_is_earliest_possible && !retired && (
                      <span className="ml-2 text-xs text-ink-muted">earliest possible</span>
                    )}
                  </td>
                  <td className="py-3 text-ink-secondary">
                    {row.replacement_id ? (
                      <code>{row.replacement_id.split(":").pop()}</code>
                    ) : (
                      <span className="text-ink-muted">none announced</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
