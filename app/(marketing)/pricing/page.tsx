import type { Metadata } from "next";
import { UpgradeButton } from "../interest-forms.tsx";

export const metadata: Metadata = {
  title: "Pricing · aidep",
  description: "Everything is free on every repo, including migration PRs. $99 per org per month adds the eval run that proves behavior held.",
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
            <p className="text-ink-secondary">$99</p>
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

      <p className="mt-14 max-w-2xl border-t border-rule pt-4 text-xs leading-relaxed text-ink-muted">
        The eval runs on your own API keys, so a migration PR costs you roughly $0.20 to $2.00 of
        model spend plus 4 to 8 CI minutes. We would rather you saw that number here than on your
        next invoice. Launch pricing; existing installs keep their rate.
      </p>
    </div>
  );
}
