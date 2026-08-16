import type { Metadata } from "next";
import { UpgradeButton } from "../interest-forms.tsx";

export const metadata: Metadata = {
  title: "Pricing · aidep",
  description: "Free for public repos and one private repo. $29 per private repo per month, flat.",
};

export default function PricingPage() {
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  const installUrl = slug ? `https://github.com/apps/${slug}/installations/new` : "/#waitlist";

  return (
    <div className="mx-auto max-w-5xl px-6 pb-20 pt-16">
      <h1 className="text-4xl tracking-tight">Pricing</h1>
      <p className="mt-3 max-w-xl text-lg text-ink-secondary">
        Free is the default, not a trial. Paid exists for private repos that want the PRs and the
        evals.
      </p>

      <div className="mt-12 grid gap-10 md:grid-cols-5 md:gap-14">
        <section className="border-t-2 border-ink pt-6 md:col-span-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-3xl">Free</h2>
            <p className="text-ink-secondary">$0</p>
          </div>
          <ul className="mt-6 max-w-md space-y-3 text-sm leading-relaxed text-ink-secondary">
            <li className="border-b border-rule pb-3">Every public repo, no cap</li>
            <li className="border-b border-rule pb-3">
              Scanning, deprecation alerts, and the onboarding audit PR, always free
            </li>
            <li className="border-b border-rule pb-3">1 private repo included</li>
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
            <h2 className="text-3xl">Pro</h2>
            <p className="text-ink-secondary">$29</p>
          </div>
          <p className="mt-1 text-sm text-ink-muted">per private repo per month, flat</p>
          <ul className="mt-6 space-y-3 text-sm leading-relaxed text-ink-secondary">
            <li className="border-b border-rule pb-3">Migration PRs on private repos</li>
            <li className="border-b border-rule pb-3">Eval packs on private repos</li>
            <li className="border-b border-rule pb-3">No per-seat pricing, no usage metering</li>
          </ul>
          <UpgradeButton />
        </section>
      </div>

      <p className="mt-14 border-t border-rule pt-4 text-xs text-ink-muted">
        Prices are launch pricing; existing installs keep their rate.
      </p>
    </div>
  );
}
