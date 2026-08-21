import Link from "next/link";
import { loadRegistry, type RegistryRow } from "../../src/registry.ts";
import { daysLabel, daysUntil, formatDies } from "./dates.ts";
import { WaitlistForm } from "./interest-forms.tsx";

/* Re-render hourly so the days-away chips stay honest. */
export const revalidate = 3600;

const PROVIDER: Record<RegistryRow["provider"], string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

/* Retired heavyweights for the "already dead" band; order is display order. */
const DEAD_PICKS = [
  "anthropic:model:claude-3-5-sonnet-20241022",
  "google:model:gemini-2.0-flash",
  "openai:model:chatgpt-4o-latest",
  "anthropic:model:claude-opus-4-1-20250805",
];

function shortId(row: RegistryRow): string {
  return row.id.split(":").slice(2).join(":");
}

function DaysChip({ days }: { days: number }) {
  const tone =
    days <= 0
      ? "bg-dead-bg text-dead"
      : days <= 90
        ? "bg-dying-bg text-dying"
        : "border border-rule text-ink-secondary";
  return (
    <span className={`ml-2 inline-block whitespace-nowrap px-1.5 py-0.5 text-xs ${tone}`}>
      {daysLabel(days)}
    </span>
  );
}

export default async function LandingPage() {
  const rows = await loadRegistry();
  const now = new Date();
  // One row per retirement date. Six Sora variants sharing 2026-09-24 is one
  // deadline, not six, and printing it six times buries the rest of the year.
  type Dated = RegistryRow & { dies: string };
  const byDate = new Map<string, Dated[]>();
  for (const r of rows
    .filter((r): r is RegistryRow & { dies: string } => r.dies !== null && daysUntil(r.dies, now) >= 0)
    .sort((a, b) => a.dies.localeCompare(b.dies) || a.id.localeCompare(b.id))) {
    const same = byDate.get(r.dies);
    if (same) same.push(r);
    else byDate.set(r.dies, [r]);
  }
  const upcoming = [...byDate.values()].slice(0, 8).map((group) => ({
    lead: group[0],
    alsoDying: group.length - 1,
  }));
  const dead = DEAD_PICKS.map((id) => rows.find((r) => r.id === id)).filter(
    (r): r is RegistryRow => r !== undefined,
  );

  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  const installUrl = slug ? `https://github.com/apps/${slug}/installations/new` : null;

  return (
    <>
      {/* Dateline strip: what the register holds, as of when. */}
      <div className="mx-auto max-w-5xl px-6">
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-rule py-2 text-[11px] uppercase tracking-widest text-ink-muted">
          <span>
            <span className="text-ink">{rows.length}</span> deprecations on file
          </span>
          <span>OpenAI · Anthropic · Google</span>
          <span>
            {now.toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        </div>
      </div>

      <section className="mx-auto max-w-5xl px-6 pb-16 pt-10 sm:pt-14">
        <p className="text-xs uppercase tracking-widest text-ink-muted">Still shipping to production</p>
        <h1 className="figure mt-3 text-[clamp(4rem,15vw,9.5rem)] leading-[0.86] text-ink">308,224</h1>
        <p className="mt-4 max-w-3xl text-2xl leading-[1.15] tracking-tight sm:text-4xl">
          files on GitHub still call a model that died ten months ago.
        </p>
        {/* The drop cap takes the first character, so this paragraph has to open
         * on a letter. Starting it on a figure sets a giant "1" beside "6,320". */}
        <p className="dropcap mt-8 max-w-2xl leading-relaxed text-ink-secondary">
          Another 16,320 call an API that shuts down on August 26. Nobody wakes up on the fifteenth
          of October and thinks to check for retired model ids, which is exactly why those numbers
          are what they are. aidep finds yours, opens the migration PR, and proves behavior held.
        </p>
        <p className="mt-4 max-w-2xl text-sm text-ink-muted">
          Counts from GitHub code search on 2026-08-18, one query each:{" "}
          <code>&quot;claude-3-5-sonnet-20241022&quot;</code> (retired 2025-10-28) and{" "}
          <code>&quot;client.beta.threads&quot;</code>. Run them yourself.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          {installUrl ? (
            <a
              href={installUrl}
              className="inline-block bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/85"
            >
              Install on GitHub
            </a>
          ) : (
            <a
              href="#waitlist"
              className="inline-block bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/85"
            >
              Join the waitlist
            </a>
          )}
          <Link
            href="/dead"
            className="inline-block border border-rule px-5 py-2.5 text-sm text-ink-secondary hover:border-ink-muted hover:text-ink"
          >
            See what is already dead
          </Link>
          <Link href="/security" className="text-sm text-link underline underline-offset-4">
            Security
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-14">
        <p className="text-[11px] uppercase tracking-widest text-ink-muted">The calendar</p>
        <div className="rule-pair mt-2 flex flex-wrap items-baseline justify-between gap-2 pt-5">
          <h2 className="text-3xl sm:text-4xl">What dies next</h2>
          <p className="text-sm text-ink-muted">from the aidep registry, dates as published by each provider</p>
        </div>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs uppercase tracking-wider text-ink-muted">
                <th className="py-2 pr-4 font-medium">Identifier</th>
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 pr-4 font-medium">Dies</th>
                <th className="py-2 font-medium">Replacement</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map(({ lead, alsoDying }) => (
                <tr key={lead.id} className="border-b border-rule">
                  <td className="py-2.5 pr-4 font-mono text-[13px] text-ink">
                    {shortId(lead)}
                    {alsoDying > 0 && (
                      <span className="ml-2 font-body text-xs text-ink-muted">
                        +{alsoDying} more that day
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-ink-secondary">{PROVIDER[lead.provider]}</td>
                  <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums text-ink">
                    {formatDies(lead.dies)}
                    <DaysChip days={daysUntil(lead.dies, now)} />
                  </td>
                  <td className="py-2.5 text-ink-secondary">
                    {lead.replacement_id ?? lead.replacement_notes ?? "none announced"}
                  </td>
                </tr>
              ))}
              <tr>
                <td
                  colSpan={4}
                  className="border-b border-rule pb-2 pt-10 text-xs uppercase tracking-wider text-ink-muted"
                >
                  Already dead
                </td>
              </tr>
              {dead.map((r) => (
                <tr key={r.id} className="border-b border-rule">
                  <td className="py-2.5 pr-4 font-mono text-[13px] text-ink-muted line-through">
                    {shortId(r)}
                  </td>
                  <td className="py-2.5 pr-4 text-ink-muted">{PROVIDER[r.provider]}</td>
                  <td className="whitespace-nowrap py-2.5 pr-4 text-ink-muted">
                    {r.dies ? formatDies(r.dies) : "retired"}
                    <span className="ml-2 inline-block whitespace-nowrap bg-dead-bg px-1.5 py-0.5 text-xs text-dead">
                      calls fail today
                    </span>
                  </td>
                  <td className="py-2.5 text-ink-secondary">
                    {r.replacement_id ?? r.replacement_notes ?? "none announced"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-14">
        <p className="text-[11px] uppercase tracking-widest text-ink-muted">In three moves</p>
        <h2 className="rule-pair mt-2 pt-5 text-3xl sm:text-4xl">How it works</h2>
        <ol className="mt-4">
          <li className="grid gap-3 border-t border-rule py-9 sm:grid-cols-[7rem_1fr]">
            <div className="figure text-6xl leading-none text-ink-muted">1</div>
            <div className="max-w-xl">
              <h3 className="text-xl">Install</h3>
              <p className="mt-2 leading-relaxed text-ink-secondary">
                Three GitHub permissions, listed in full on the security page. aidep opens one
                onboarding PR: the complete audit of your repo, every deprecated identifier with
                file and line. Nothing else happens until you merge it.
              </p>
            </div>
          </li>
          <li className="grid gap-3 border-t border-rule py-9 sm:grid-cols-[7rem_1fr]">
            <div className="figure text-6xl leading-none text-ink-muted">2</div>
            <div className="max-w-xl">
              <h3 className="text-xl">Opt in to migration PRs</h3>
              <p className="mt-2 leading-relaxed text-ink-secondary">
                One PR per deprecation, grouping every file it touches. The safe rewrites are
                applied; anything that can&rsquo;t be rewritten safely becomes a manual checklist in
                the PR body, not a guess. aidep never touches .github/workflows.
              </p>
            </div>
          </li>
          <li className="grid gap-3 border-t border-rule py-9 sm:grid-cols-[7rem_1fr]">
            <div className="figure text-6xl leading-none text-ink-muted">3</div>
            <div>
              <h3 className="text-xl">Merge on evidence</h3>
              <p className="mt-2 max-w-xl leading-relaxed text-ink-secondary">
                Turn on evals and a model-swap PR ships a pack that replays your prompts against the
                old model and the new one, in your CI with your keys, and posts the result. That
                comment is the merge decision.
              </p>
              <div className="mt-6 max-w-xl border border-rule bg-paper-raised p-4">
                <p className="text-xs text-ink-muted">github-actions bot commented on #241</p>
                <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-ink">
                  {`eval gpt-4o-2024-05-13 -> gpt-5.6-sol
behavior held on 18/20 prompts

held     summarize_invoice     exact match
held     classify_ticket       exact match
held     draft_reply           semantic match
drifted  extract_line_items    "qty" became "quantity"
drifted  refund_policy_answer  cites a newer cutoff date
+ 15 more held`}
                </pre>
              </div>
            </div>
          </li>
        </ol>
        <p className="max-w-xl border-t border-rule pt-6 text-sm leading-relaxed text-ink-secondary">
          Why deterministic matters: OpenAI&rsquo;s own migration guide points at prompt objects
          that are themselves deprecated (dead Nov 30, 2026). aidep inlines configs instead.
        </p>
      </section>

      <section id="waitlist" className="mx-auto max-w-5xl px-6 pb-20 pt-14">
        <p className="text-[11px] uppercase tracking-widest text-ink-muted">The back page</p>
        <div className="rule-pair mt-2 pt-5">
          <h2 className="text-3xl sm:text-4xl">Not ready to install a GitHub App?</h2>
          <p className="mt-2 max-w-xl leading-relaxed text-ink-secondary">
            Leave an email. We&rsquo;ll write when the next shutdown date gets close, and nothing
            else.
          </p>
          <WaitlistForm />
        </div>
      </section>
    </>
  );
}
