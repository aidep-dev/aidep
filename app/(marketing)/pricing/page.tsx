import type { Metadata } from "next";
import { loadRegistry } from "../../../src/registry.ts";
import { UpgradeButton } from "../interest-forms.tsx";
import { Kicker } from "../kicker.tsx";
import { installUrl } from "../site.ts";

export const metadata: Metadata = {
  title: "Pricing · aidep",
  description: "Everything is free on every repo, including migration PRs. $39 per org per month adds the eval run that proves behavior held. Here is the arithmetic behind that number.",
};

/* The per-year counts in the arithmetic come from the registry, like every other number on the site. */
export const revalidate = 3600;

export default async function PricingPage() {
  const rows = await loadRegistry();
  const datesIn = (year: string) => new Set(rows.filter((r) => r.dies?.startsWith(year)).map((r) => r.dies)).size;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-20 pt-16">
      <Kicker>free on every repo · one paid line</Kicker>
      <h1 className="mt-4 text-5xl sm:text-6xl">Pricing</h1>
      <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
        Finding the problem and fixing it are free, on every repo you own. The paid line is the
        proof that the fix did not change behavior.
      </p>

      <div className="mt-12 grid gap-10 md:grid-cols-5 md:gap-14">
        <div className="panel md:col-span-3">
          <div className="panel-head label">free</div>
          <div className="px-5 py-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-3xl">Free</h2>
              <p className="text-ink-secondary">$0</p>
            </div>
            <ul className="mt-6 max-w-md space-y-3 text-sm leading-relaxed text-ink-secondary">
              <li className="border-b border-rule pb-3">Every repo, public or private, no cap</li>
              <li className="border-b border-rule pb-3">
                Scanning, deprecation alerts, and the onboarding audit PR
              </li>
              <li className="border-b border-rule pb-3">
                Migration PRs, with the manual checklist for anything we will not rewrite blindly
              </li>
              <li className="border-b border-rule pb-3">No seat limit, no card</li>
            </ul>
            <a href={installUrl()} className="btn mt-8 px-5 py-3">
              install on github →
            </a>
          </div>
        </div>

        <div className="panel md:col-span-2">
          <div className="panel-head label">proof</div>
          <div className="px-5 py-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-3xl">Proof</h2>
              <p className="text-ink-secondary">$39</p>
            </div>
            <p className="mt-1 text-sm text-ink-muted">per org per month, flat</p>
            <ul className="mt-6 space-y-3 text-sm leading-relaxed text-ink-secondary">
              <li className="border-b border-rule pb-3">
                An eval pack on every migration PR: your prompts, old model against new
              </li>
              <li className="border-b border-rule pb-3">
                Runs in your CI with your keys. We never hold them
              </li>
              <li className="border-b border-rule pb-3">
                Held or drifted per prompt, in the PR body, before you merge
              </li>
              <li className="border-b border-rule pb-3">
                Every repo in the org. No per-seat, no per-repo, no metering
              </li>
            </ul>
            <UpgradeButton />
            <p className="mt-3 text-xs text-ink-muted">
              Leave an address and we reply by hand. No card here yet; the first orgs are set up one
              at a time.
            </p>
          </div>
        </div>
      </div>

      <section className="mt-20 border-t border-rule pt-6">
        <h2 className="text-2xl">Where $39 comes from</h2>
        <p className="mt-2 max-w-xl text-ink-secondary">
          Most pricing pages ask you to take the number on faith. Here is the arithmetic, so you
          can argue with the assumptions instead.
        </p>

        <h3 className="mt-10 text-lg">What a year of deprecations costs you</h3>
        <div className="panel mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[18%]" />
              <col />
            </colgroup>
            <thead>
              <tr className="label border-b border-rule text-left text-ink-muted">
                <th className="px-4 py-2.5 font-normal">input</th>
                <th className="px-4 py-2.5 font-normal">assumed</th>
                <th className="px-4 py-2.5 font-normal">why</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                <td className="px-4 py-3 text-ink">Retirements that hit your code</td>
                <td className="px-4 py-3 tabular-nums text-ink-secondary">3 / year</td>
                <td className="px-4 py-3 font-display text-sm text-ink-secondary">
                  Our registry counts {datesIn("2024")} distinct retirement dates in 2024,{" "}
                  {datesIn("2025")} in 2025 and {datesIn("2026")} in 2026 across OpenAI, Anthropic
                  and Google. You intersect a fraction of those
                </td>
              </tr>
              <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                <td className="px-4 py-3 text-ink">Engineer hours per retirement</td>
                <td className="px-4 py-3 tabular-nums text-ink-secondary">8</td>
                <td className="px-4 py-3 font-display text-sm text-ink-secondary">
                  Finding every call site, rewriting, and confirming behavior held. Range is 4 to
                  16; this is the midpoint
                </td>
              </tr>
              <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                <td className="px-4 py-3 text-ink">Loaded hourly cost</td>
                <td className="px-4 py-3 tabular-nums text-ink-secondary">$100</td>
                <td className="px-4 py-3 font-display text-sm text-ink-secondary">
                  Below the $150 to $250 that senior US rates actually run, so this understates the
                  value rather than flattering it
                </td>
              </tr>
              <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                <td className="px-4 py-3 text-ink">Value per year</td>
                <td className="px-4 py-3 tabular-nums text-ink">$2,400</td>
                <td className="px-4 py-3 font-display text-sm text-ink-secondary">3 × 8 × $100, before counting any outage</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-secondary">
          The usual bar for software is that you should get back at least ten times what you pay,
          which caps this at $240 a year. Taking 10 to 20 percent of value created, the other
          standard method, gives $240 to $480. <span className="text-ink">$39 a month is $468</span>
          , at the top of that band for a light user and well inside it for anyone with real
          exposure.
        </p>

        <h3 className="mt-12 text-lg">What the alternatives charge</h3>
        <div className="panel mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[55%]" />
              <col />
            </colgroup>
            <thead>
              <tr className="label border-b border-rule text-left text-ink-muted">
                <th className="px-4 py-2.5 font-normal">tool</th>
                <th className="px-4 py-2.5 font-normal">price</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                <td className="px-4 py-3 text-ink">Dependabot, Renovate</td>
                <td className="px-4 py-3 font-display text-sm text-ink-secondary">$0, and they should be</td>
              </tr>
              <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                <td className="px-4 py-3 text-ink">Mend Renovate Enterprise</td>
                <td className="px-4 py-3 tabular-nums text-ink-secondary">$250 per developer per year</td>
              </tr>
              <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                <td className="px-4 py-3 text-ink">CodeRabbit Pro</td>
                <td className="px-4 py-3 tabular-nums text-ink-secondary">$24 to $30 per developer per month</td>
              </tr>
              <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                <td className="px-4 py-3 text-ink">Snyk Team</td>
                <td className="px-4 py-3 tabular-nums text-ink-secondary">$25 to $52 per developer per month</td>
              </tr>
              <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                <td className="px-4 py-3 text-ink">aidep Proof</td>
                <td className="px-4 py-3 tabular-nums text-ink">$39 per org per month</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-secondary">
          Finding the problem is free here because free is what the alternatives charge for it.
          Flat per org, not per developer, because adding a teammate does not add exposure and we
          would rather not tax you for it.
        </p>
      </section>

      <p className="mt-14 max-w-2xl border-t border-rule pt-4 text-xs leading-relaxed text-ink-muted">
        The eval runs on your own API keys, so a migration PR costs you roughly $0.20 to $2.00 of
        model spend plus 4 to 8 CI minutes. We would rather you saw that number here than on your
        next invoice. Launch pricing; existing installs keep their rate.
      </p>
    </div>
  );
}
