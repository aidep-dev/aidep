import type { Metadata } from "next";
import { Kicker } from "../kicker.tsx";

export const metadata: Metadata = {
  title: "Security · aidep",
  description: "What aidep can touch, what it stores, and what it never sees.",
};

const SECTIONS = [
  { id: "permissions", label: "Permissions" },
  { id: "your-code", label: "Your code" },
  { id: "your-inbox", label: "Your inbox" },
  { id: "your-keys", label: "Your keys" },
  { id: "this-site", label: "This site" },
  { id: "self-hosting", label: "Self-hosting" },
  { id: "uninstall", label: "On uninstall" },
  { id: "report", label: "Report a vulnerability" },
];

export default function SecurityPage() {
  const domain = new URL(process.env.APP_URL ?? "https://aidep.example").hostname;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-20 pt-16 md:grid md:grid-cols-[13rem_1fr] md:gap-14">
      {/* the contents: a sticky rail beside the text on md+, one wrapping row above it on phones */}
      <nav aria-label="On this page" className="md:sticky md:top-20 md:self-start">
        <p className="label text-ink-muted">on this page</p>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-b border-rule pb-4 md:block md:space-y-3 md:border-b-0 md:pb-0">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="label text-ink-secondary hover:text-ink">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div>
        <Kicker className="mt-10 md:mt-0">three permissions · findings only · no keys</Kicker>
        <h1 className="mt-4 text-5xl sm:text-6xl">Security</h1>
        <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
          What aidep can touch, what it stores, and what it never sees.
        </p>

        <section id="permissions" className="mt-14 border-t border-rule pt-6">
          <h2 className="text-2xl">Permissions</h2>
          <p className="mt-2 text-ink-secondary">We request 3 permissions. Comparable tools request 10.</p>
          <div className="panel mt-5 overflow-x-auto">
            <table className="w-full min-w-[480px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[22%]" />
                <col />
              </colgroup>
              <thead>
                <tr className="label border-b border-rule text-left text-ink-muted">
                  <th className="px-4 py-2.5 font-normal">permission</th>
                  <th className="px-4 py-2.5 font-normal">level</th>
                  <th className="px-4 py-2.5 font-normal">why</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                  <td className="px-4 py-3 text-ink">Metadata</td>
                  <td className="px-4 py-3 text-ink-secondary">Read</td>
                  <td className="px-4 py-3 font-display text-sm text-ink-secondary">Mandatory for all GitHub Apps</td>
                </tr>
                <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                  <td className="px-4 py-3 text-ink">Contents</td>
                  <td className="px-4 py-3 text-ink-secondary">Read and write</td>
                  <td className="px-4 py-3 font-display text-sm text-ink-secondary">
                    Branch creation requires it; the API cannot open a PR without it
                  </td>
                </tr>
                <tr className="border-b border-rule last:border-b-0 hover:bg-row-hover">
                  <td className="px-4 py-3 text-ink">Pull requests</td>
                  <td className="px-4 py-3 text-ink-secondary">Read and write</td>
                  <td className="px-4 py-3 font-display text-sm text-ink-secondary">
                    Opening and updating the PRs is the product
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="your-code" className="mt-12 border-t border-rule pt-6">
          <h2 className="text-2xl">Your code</h2>
          <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
            We fetch a tarball of your repo at scan time, scan it in memory, and discard it. We never
            store your source code. We store findings only: file path, line number, the matched
            identifier, and the registry row it matched. Repo access uses GitHub&rsquo;s 1-hour
            installation tokens.
          </p>
          <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
            One exception, and only if you turn on evals: to draft the eval cases for a migration PR,
            we send the affected files to Anthropic once each, using our own key, to extract the
            prompts. The cases land in the PR for you to read before anything runs. Leave evals off
            (the default) and your code never leaves the scan.
          </p>
        </section>

        <section id="your-inbox" className="mt-12 border-t border-rule pt-6">
          <h2 className="text-2xl">Your inbox</h2>
          <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
            We hold an email address only if you typed it: into{" "}
            <code className="font-mono text-[0.9em] text-ink">notify</code> in{" "}
            <code className="font-mono text-[0.9em] text-ink">.github/aidep.json</code>, or the
            waitlist form. It gets one confirmation mail with a link and nothing else until the link
            is clicked. After that, plain text through Resend: a{" "}
            <code className="font-mono text-[0.9em] text-ink">notify</code> address gets a digest
            when a scan finds a new exposure or a retirement is inside 30 days; a waitlist address
            gets one mail per retirement date inside 14 days. We never read an address from GitHub;
            that would be a fourth permission. Every mail carries a one-click stop link, and a
            stopped address never hears from us again.
          </p>
        </section>

        <section id="your-keys" className="mt-12 border-t border-rule pt-6">
          <h2 className="text-2xl">Your keys</h2>
          <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
            The eval runs happen in your CI with your keys. We never hold the keys that run your
            prompts, and the held/drifted output stays in your repo as a PR comment. The one key we do
            hold is our own Anthropic key, used only to draft eval cases from your code when you opt
            in (see &ldquo;Your code&rdquo;).
          </p>
        </section>

        <section id="this-site" className="mt-12 border-t border-rule pt-6">
          <h2 className="text-2xl">This site</h2>
          <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
            The site runs Vercel Web Analytics: cookieless page counts, no cross-site tracking, no
            advertising identifiers.
          </p>
        </section>

        <section id="self-hosting" className="mt-12 border-t border-rule pt-6">
          <h2 className="text-2xl">Self-hosting</h2>
          <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
            The whole product is a Next.js app and a Postgres; see{" "}
            <a href="https://github.com/aidep-dev/aidep" className="text-ink underline underline-offset-4">
              the README
            </a>
            . If your policy says no third-party app touches the code, run it yourself.
          </p>
        </section>

        <section id="uninstall" className="mt-12 border-t border-rule pt-6">
          <h2 className="text-2xl">On uninstall</h2>
          <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
            Uninstalling the app purges all stored findings immediately.
          </p>
        </section>

        <section id="report" className="mt-12 border-t border-rule pt-6">
          <h2 className="text-2xl">Report a vulnerability</h2>
          <p className="mt-3 max-w-xl leading-relaxed text-ink-secondary">
            Email{" "}
            <a href={`mailto:security@${domain}`} className="text-ink underline underline-offset-4">
              security@{domain}
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
