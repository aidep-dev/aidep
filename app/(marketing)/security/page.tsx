import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security · aidep",
  description: "What aidep can touch, what it stores, and what it never sees.",
};

export default function SecurityPage() {
  const domain = new URL(process.env.APP_URL ?? "https://aidep.example").hostname;

  return (
    <div className="mx-auto max-w-3xl px-6 pb-20 pt-16">
      <h1 className="text-5xl sm:text-6xl">Security</h1>
      <p className="mt-3 max-w-xl text-lg text-ink-secondary">
        What aidep can touch, what it stores, and what it never sees.
      </p>

      <section className="mt-14 border-t border-rule pt-6">
        <h2 className="text-2xl">Permissions</h2>
        <p className="mt-2 text-ink-secondary">We request 3 permissions. Comparable tools request 10.</p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="label border-b border-rule text-left text-ink-muted">
                <th className="py-2 pr-4 font-medium">Permission</th>
                <th className="py-2 pr-4 font-medium">Level</th>
                <th className="py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Metadata</td>
                <td className="py-2.5 pr-4 text-ink-secondary">Read</td>
                <td className="py-2.5 text-ink-secondary">Mandatory for all GitHub Apps</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Contents</td>
                <td className="py-2.5 pr-4 text-ink-secondary">Read and write</td>
                <td className="py-2.5 text-ink-secondary">
                  Branch creation requires it; the API cannot open a PR without it
                </td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2.5 pr-4 text-ink">Pull requests</td>
                <td className="py-2.5 pr-4 text-ink-secondary">Read and write</td>
                <td className="py-2.5 text-ink-secondary">
                  Opening and updating the PRs is the product
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12 border-t border-rule pt-6">
        <h2 className="text-2xl">Your code</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
          We fetch a tarball of your repo at scan time, scan it in memory, and discard it. We never
          store your source code. We store findings only: file path, line number, and the matched
          identifier. Repo access uses GitHub&rsquo;s 1-hour installation tokens.
        </p>
        <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
          One exception, and only if you turn on evals: to draft the eval cases for a migration PR,
          we send the affected files to Anthropic once each, using our own key, to extract the
          prompts. The cases land in the PR for you to read before anything runs. Leave evals off
          (the default) and your code never leaves the scan.
        </p>
        <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
          Uninstalling the app purges all stored findings immediately.
        </p>
      </section>

      <section className="mt-12 border-t border-rule pt-6">
        <h2 className="text-2xl">Your inbox</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
          We hold an email address only if you typed it: into <code>notify</code> in{" "}
          <code>.github/aidep.json</code>, or the waitlist form. It gets one confirmation mail with
          a link and nothing else until the link is clicked. After that, plain text through Resend:
          a <code>notify</code> address gets a digest when a scan finds a new exposure or a
          retirement is inside 30 days; a waitlist address gets one mail per retirement date inside
          14 days. We never read an address from GitHub; that would be a fourth permission. Every
          mail carries a one-click stop link, and a stopped address never hears from us again.
        </p>
        <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
          The site runs Vercel Web Analytics: cookieless page counts, no cross-site tracking, no
          advertising identifiers.
        </p>
      </section>

      <section className="mt-12 border-t border-rule pt-6">
        <h2 className="text-2xl">Your keys</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
          The eval runs happen in your CI with your keys. We never hold the keys that run your
          prompts, and the held/drifted output stays in your repo as a PR comment. The one key we do
          hold is our own Anthropic key, used only to draft eval cases from your code when you opt
          in (see &ldquo;Your code&rdquo;).
        </p>
      </section>

      <section className="mt-12 border-t border-rule pt-6">
        <h2 className="text-2xl">Self-hosting</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
          The whole product is a Next.js app and a Postgres; see the README. If your policy says no
          third-party app touches the code, run it yourself.
        </p>
      </section>

      <section className="mt-14 border-t border-rule pt-6">
        <p className="text-sm text-ink-secondary">
          Found a vulnerability? Email{" "}
          <a href={`mailto:security@${domain}`} className="text-ink underline underline-offset-4">
            security@{domain}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
