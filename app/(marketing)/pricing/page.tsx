import type { Metadata } from "next";
import { UpgradeButton } from "../interest-forms.tsx";

export const metadata: Metadata = {
  title: "Pricing · aidep",
  description: "Everything is free on every repo, including migration PRs. $39 per org per month adds the eval run that proves behavior held. Here is the arithmetic behind that number.",
};

export default function PricingPage() {
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  const installUrl = slug ? `https://github.com/apps/${slug}/installations/new` : "/#waitlist";

  return (
    <div className="mx-auto max-w-5xl px-6 pb-20 pt-16">
      <h1 className="text-4xl tracking-tight">Pricing</h1>
      <p className="mt-3 max-w-xl text-lg text-ink-secondary">
        Finding the problem and fixing it are free, on every repo you own. The paid line is the
        proof that the fix did not change behavior.
      </p>

      <div className="mt-12 grid gap-10 md:grid-cols-5 md:gap-14">
        <section className="border-t-2 border-ink pt-6 md:col-span-3">
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
          <a
            href={installUrl}
            className="mt-8 inline-block bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/85"
          >
            Start free
          </a>
        </section>

        <section className="border-t border-rule pt-6 md:col-span-2">
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
        </section>
      </div>

      <section className="mt-20 border-t border-rule pt-6">
        <h2 className="text-2xl">Where $39 comes from</h2>
        <p className="mt-2 max-w-xl text-ink-secondary">
          Most pricing pages ask you to take the number on faith. Here is the arithmetic, so you
          can argue with the assumptions instead.
        </p>

        <h3 className="mt-10 text-lg">What a year of deprecations costs you</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs uppercase tracking-wider text-ink-muted">
                <th className="py-2 pr-4 font-medium">Input</th>
                <th className="py-2 pr-4 font-medium">Assumed</th>
                <th className="py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Retirements that hit your code</td>
                <td className="py-2.5 pr-4 tabular-nums text-ink-secondary">3 / year</td>
                <td className="py-2.5 text-ink-secondary">
                  Our registry counted 6 distinct retirement dates in 2024, 14 in 2025 and 31 in
                  2026 across OpenAI, Anthropic and Google. You intersect a fraction of those
                </td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Engineer hours per retirement</td>
                <td className="py-2.5 pr-4 tabular-nums text-ink-secondary">8</td>
                <td className="py-2.5 text-ink-secondary">
                  Finding every call site, rewriting, and confirming behaviour held. Range is 4 to
                  16; this is the midpoint
                </td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Loaded hourly cost</td>
                <td className="py-2.5 pr-4 tabular-nums text-ink-secondary">$100</td>
                <td className="py-2.5 text-ink-secondary">
                  Below the $150 to $250 that senior US rates actually run, so this understates the
                  value rather than flattering it
                </td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Value per year</td>
                <td className="py-2.5 pr-4 tabular-nums text-ink">$2,400</td>
                <td className="py-2.5 text-ink-secondary">3 × 8 × $100, before counting any outage</td>
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
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs uppercase tracking-wider text-ink-muted">
                <th className="py-2 pr-4 font-medium">Tool</th>
                <th className="py-2 font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Dependabot, Renovate</td>
                <td className="py-2.5 text-ink-secondary">$0, and they should be</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Mend Renovate Enterprise</td>
                <td className="py-2.5 tabular-nums text-ink-secondary">$250 per developer per year</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">CodeRabbit Pro</td>
                <td className="py-2.5 tabular-nums text-ink-secondary">$24 to $30 per developer per month</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Snyk Team</td>
                <td className="py-2.5 tabular-nums text-ink-secondary">$25 to $52 per developer per month</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">aidep Proof</td>
                <td className="py-2.5 tabular-nums text-ink">$39 per org per month</td>
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
