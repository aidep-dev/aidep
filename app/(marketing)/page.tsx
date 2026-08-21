import Link from "next/link";
import { impactFigures } from "../../src/exposure.ts";
import { loadRegistry, type RegistryRow } from "../../src/registry.ts";
import { Mark } from "../mark.tsx";
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
  return <span className={`label ml-2 inline-block whitespace-nowrap px-1.5 py-0.5 ${tone}`}>{daysLabel(days)}</span>;
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="label flex items-center gap-3 text-ink-muted">
      <span className="inline-block h-px w-8 bg-rule-strong" aria-hidden />
      {children}
    </p>
  );
}

export default async function LandingPage() {
  const [rows, impact] = await Promise.all([loadRegistry(), impactFigures()]);
  const now = new Date();

  // One row per retirement date. Six Sora variants sharing 2026-09-24 is one
  // deadline, not six, and printing it six times buries the rest of the year.
  type Dated = RegistryRow & { dies: string };
  const byDate = new Map<string, Dated[]>();
  for (const r of rows
    .filter((r): r is Dated => r.dies !== null && daysUntil(r.dies, now) >= 0)
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
  const futureRows = rows.filter((r) => r.dies !== null && daysUntil(r.dies, now) >= 0).length;
  // Rows whose named replacement is itself in the registry. replacement_id is a
  // bare api id ("gpt-4o-mini"), not a registry id, so it is matched against
  // every row's api_ids. Every registry row is deprecated or retired, so a hit
  // is a rotted replacement by definition. This is the number the "why not my
  // agent" section rests on, so it is computed, not typed.
  const withReplacement = rows.filter((r) => r.replacement_id !== null);
  const knownApiIds = new Set(rows.flatMap((r) => r.api_ids));
  const rottedReplacements = withReplacement.filter((r) =>
    knownApiIds.has(r.replacement_id as string),
  ).length;
  const datesThisYear = new Set(
    rows.map((r) => r.dies).filter((d): d is string => d !== null && d.startsWith(String(now.getFullYear()))),
  ).size;
  const next = upcoming[0];

  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  const installUrl = slug ? `https://github.com/apps/${slug}/installations/new` : "#waitlist";

  return (
    <>
      {/* ---- hero ---- */}
      <section className="relative overflow-hidden">
        {/* The mark, large and faint, bleeding off the right edge. Herdr does
         * this with its ram; it gives the hero a second layer without a photo. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-8 w-[34rem] text-ink opacity-[0.06] sm:-right-16 sm:w-[40rem]"
        >
          <Mark variant="dying" className="h-auto w-full" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-20 sm:pt-28">
          <Kicker>the deprecation register</Kicker>
          <h1 className="mt-6 max-w-4xl text-[clamp(2.75rem,7.5vw,5.5rem)] leading-[0.95] text-ink">
            Know what dies.
            <br />
            <span className="em">Before</span> it takes you down.
          </h1>
          <p className="mt-8 max-w-xl leading-relaxed text-ink-secondary">
            Every OpenAI, Anthropic and Google model and API retirement, dated and sourced. aidep
            finds the ones your code still calls, opens the migration PR, and proves behavior held
            in your own CI.
          </p>

          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="panel flex items-stretch font-mono text-sm">
              <code className="flex items-center gap-3 px-4 py-2.5 text-ink">
                <span className="text-ink-muted">$</span>
                <span>npx aidep .</span>
              </code>
              <span className="label flex items-center border-l border-rule px-3 text-ink-muted">
                no account
              </span>
            </div>
            <a
              href={installUrl}
              className="label border border-ink bg-ink px-4 py-3 text-paper hover:bg-transparent hover:text-ink"
            >
              install on github →
            </a>
          </div>

          <p className="label mt-6 text-ink-muted">
            three permissions · findings only, never source ·{" "}
            <Link href="/security" className="text-ink-secondary underline underline-offset-4 hover:text-ink">
              security
            </Link>
          </p>
        </div>
      </section>

      {/* ---- stat band ---- */}
      <section className="border-y border-rule">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-rule md:grid-cols-4 md:divide-x">
          <Stat n="308,224" label="files still call a model that died in 2025" />
          <Stat n={String(rows.length)} label="deprecations on file, each with its vendor source" />
          <Stat n={String(futureRows)} label="retirements still ahead" />
          <Stat
            n={next ? daysLabel(daysUntil(next.lead.dies, now)) : "none"}
            label={next ? `until ${shortId(next.lead)} is gone` : "no dated retirements"}
          />
        </div>
      </section>

      {/* ---- the calendar ---- */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Kicker>the calendar</Kicker>
            <h2 className="mt-4 text-3xl sm:text-4xl">What dies next</h2>
          </div>
          <p className="label text-ink-muted">dates as published by each provider</p>
        </div>

        <div className="panel mt-8 overflow-x-auto">
          <table className="w-full min-w-[680px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[14%]" />
              <col className="w-[24%]" />
              <col />
            </colgroup>
            <thead>
              <tr className="label border-b border-rule text-left text-ink-muted">
                <th className="px-4 py-2.5 font-normal">identifier</th>
                <th className="px-4 py-2.5 font-normal">provider</th>
                <th className="px-4 py-2.5 font-normal">dies</th>
                <th className="px-4 py-2.5 font-normal">replacement</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {upcoming.map(({ lead, alsoDying }) => (
                <tr key={lead.id} className="border-b border-rule last:border-b-0">
                  <td className="px-4 py-3 text-ink">
                    {shortId(lead)}
                    {alsoDying > 0 && (
                      <span className="label ml-2 text-ink-muted">+{alsoDying} that day</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{PROVIDER[lead.provider]}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink">
                    {formatDies(lead.dies)}
                    <DaysChip days={daysUntil(lead.dies, now)} />
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">
                    {lead.replacement_id ?? lead.replacement_notes ?? "none announced"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10">
          <Kicker>already dead</Kicker>
          <div className="panel mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] table-fixed border-collapse font-mono text-[13px]">
              <colgroup>
                <col className="w-[38%]" />
                <col className="w-[14%]" />
                <col className="w-[24%]" />
                <col />
              </colgroup>
              <tbody>
                {dead.map((r) => (
                  <tr key={r.id} className="border-b border-rule last:border-b-0">
                    <td className="struck px-4 py-3">{shortId(r)}</td>
                    <td className="px-4 py-3 text-ink-muted">{PROVIDER[r.provider]}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-muted">
                      {r.dies ? formatDies(r.dies) : "retired"}
                      <span className="label ml-2 inline-block whitespace-nowrap bg-dead-bg px-1.5 py-0.5 text-dead">
                        calls fail
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {r.replacement_id ?? r.replacement_notes ?? "none announced"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="label mt-3 text-ink-muted">
            <Link href="/dead" className="text-ink-secondary underline underline-offset-4 hover:text-ink">
              the full list, with a github search you can run yourself →
            </Link>
          </p>
        </div>
      </section>

      {/* ---- how it works: herdr's numbered rows ---- */}
      <section className="border-t border-rule">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Kicker>in three moves</Kicker>
          <h2 className="mt-4 text-3xl sm:text-4xl">How it works</h2>

          <ol className="mt-10 divide-y divide-rule border-y border-rule">
            <Step
              n="01"
              title="Install"
              body="Three GitHub permissions, listed in full on the security page. aidep opens one onboarding PR: the complete audit of your repo, every deprecated identifier with file and line. Nothing else happens until you merge it."
              asideLabel="onboarding pr"
              aside={`12 findings across 7 files
 4 dead · 8 dying · nearest 2026-08-26
.github/aidep.json added`}
            />
            <Step
              n="02"
              title="Opt in to migration PRs"
              body="One PR per retirement date, grouping every file it touches. The safe rewrites are applied; anything that cannot be rewritten safely becomes a manual checklist in the PR body, not a guess. aidep never touches .github/workflows."
              asideLabel="your agent brief"
              aside={`sites     src/chat.ts:41, :88
replace   gpt-5.6-sol
verified  2026-08-21
trap      /v1/prompts dies 2026-11-30`}
            />
            <Step
              n="03"
              title="Merge on evidence"
              body="Turn on evals and a model-swap PR ships a pack that replays your prompts against the old model and the new one, in your CI with your keys, and posts the result. That comment is the merge decision."
              asideLabel="github-actions · #241"
              aside={`gpt-4o-2024-05-13 -> gpt-5.6-sol
held on 18/20 prompts

held     summarize_invoice
held     classify_ticket
drifted  extract_line_items`}
            />
          </ol>

          <p className="label mt-8 max-w-2xl leading-relaxed text-ink-muted">
            why deterministic matters: openai&rsquo;s own migration guide points at prompt objects
            that are themselves deprecated (dead 2026-11-30). aidep inlines configs instead.
          </p>
        </div>
      </section>

      {/* ---- the objection, answered ---- */}
      <section className="border-t border-rule">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-[1fr_1.2fr]">
          <div>
            <Kicker>the obvious question</Kicker>
            <h2 className="mt-4 text-3xl leading-tight sm:text-4xl">
              Why not just ask <span className="em">my</span> agent?
            </h2>
          </div>
          <div className="space-y-5 leading-relaxed text-ink-secondary">
            <p>
              Do. It is good at the rewrite. Two things it structurally cannot do: it cannot tell
              you about a date you never asked about, and it cannot know what shipped after its
              training cutoff.
            </p>
            <p>
              Of the {withReplacement.length} registry rows that name a replacement,{" "}
              <span className="text-ink">
                {rottedReplacements} name a replacement that is itself already deprecated
              </span>
              . One in {Math.round(withReplacement.length / Math.max(rottedReplacements, 1))}. An
              agent working from last year&rsquo;s docs lands on a dead target that often, then
              says &ldquo;done.&rdquo;
            </p>
            <p className="label text-ink-muted">
              aidep tells it when, and tells it what is true today.{" "}
              <Link href="/handbook" className="text-ink-secondary underline underline-offset-4 hover:text-ink">
                handbook →
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* ---- closing: insforge's centered band with the numbers underneath ---- */}
      <section id="waitlist" className="border-t border-rule">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h2 className="mx-auto max-w-3xl text-[clamp(2.25rem,6vw,4rem)] leading-[0.98]">
            Give the deadline somewhere to <span className="em">land</span>.
          </h2>
          <p className="mx-auto mt-6 max-w-xl leading-relaxed text-ink-secondary">
            Install once and the register watches your repos. Or leave an email and we will write
            when the next shutdown date gets close, and nothing else.
          </p>

          <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-4">
            <Mark variant="clean" className="mark text-[2.5rem] text-ink" />
            <a
              href={installUrl}
              className="label w-full border border-ink bg-ink px-6 py-4 text-paper hover:bg-transparent hover:text-ink"
            >
              install on github →
            </a>
            <p className="label text-ink-muted">or</p>
            <div className="w-full text-left">
              <WaitlistForm />
            </div>
          </div>

          {/* Reach, not trivia. Each figure is a sum over public code-search
           * counts or a row count in our own tables, so the band gets truer as
           * the product is used. The registry facts live in the hero band. */}
          <div className="mt-20 grid grid-cols-2 gap-4 text-left md:grid-cols-4">
            <Card
              n={impact.exposedFiles.toLocaleString("en-US")}
              label="public files exposed"
              sub={`across ${impact.queriesCounted} identifiers, counted`}
            />
            <Card
              n={String(datesThisYear)}
              label="retirement dates this year"
              sub="6 in 2024, 14 in 2025"
            />
            <Card
              n={impact.reposWatched.toLocaleString("en-US")}
              label="repos under watch"
              sub="onboarded, scanning daily"
            />
            <Card
              n={`${rottedReplacements} / ${withReplacement.length}`}
              label="replacements already dying"
              sub="what an agent would pick"
            />
          </div>
        </div>
      </section>
    </>
  );
}

function Card({ n, label, sub }: { n: string; label: string; sub: string }) {
  return (
    <div className="panel px-5 py-6 text-center">
      <p className="label text-ink-muted">{label}</p>
      <p className="figure mt-3 text-4xl leading-none text-ink sm:text-5xl">{n}</p>
      <p className="label mt-3 text-ink-muted">{sub}</p>
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="border-b border-rule px-6 py-7 md:border-b-0">
      <p className="figure text-4xl leading-none text-ink sm:text-5xl">{n}</p>
      <p className="label mt-3 text-ink-muted">{label}</p>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  asideLabel,
  aside,
}: {
  n: string;
  title: string;
  body: string;
  asideLabel: string;
  aside: string;
}) {
  return (
    <li className="grid gap-6 py-10 md:grid-cols-[5rem_1fr_minmax(0,22rem)] md:gap-10">
      <div className="figure text-5xl leading-none text-ink-muted/60">{n}</div>
      <div className="max-w-xl">
        <h3 className="mb-3 text-2xl">{title}</h3>
        <p className="leading-relaxed text-ink-secondary">{body}</p>
      </div>
      <div className="panel font-mono text-xs leading-relaxed text-ink-secondary md:mt-1">
        <div className="panel-head label">{asideLabel}</div>
        <pre className="whitespace-pre-wrap px-3.5 py-3">{aside}</pre>
      </div>
    </li>
  );
}
