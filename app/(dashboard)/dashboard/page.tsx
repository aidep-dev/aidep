import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserInstallationIds } from "../../../src/auth/session.ts";
import { daysUntil, repoIndex, type RepoIndexRow } from "../../../src/dashboard/queries.ts";
import { requireSession } from "../auth.ts";

function deathCell(r: RepoIndexRow, today: string): ReactNode {
  if (!r.onboarded_at) {
    return r.onboarding_pr_number ? (
      <a
        href={`https://github.com/${r.owner}/${r.name}/pull/${r.onboarding_pr_number}`}
        className="text-ink-muted underline decoration-rule underline-offset-2"
      >
        onboarding PR open
      </a>
    ) : (
      <span className="text-ink-muted">onboarding queued</span>
    );
  }
  if (r.dead_findings > 0) {
    return (
      <span className="inline-block rounded-sm bg-dead-bg px-2 py-0.5 text-xs font-medium text-dead">
        calls fail today
      </span>
    );
  }
  if (r.next_dies) {
    const d = daysUntil(r.next_dies, today);
    return (
      <span className="inline-flex items-baseline gap-2">
        <span className="inline-block rounded-sm bg-dying-bg px-2 py-0.5 text-xs font-medium text-dying">
          {d === 1 ? "1 day" : `${d} days`}
        </span>
        <span className="text-xs text-ink-secondary">{r.next_dies}</span>
      </span>
    );
  }
  if (r.open_findings === 0) {
    return (
      <span className="inline-block rounded-sm bg-clean-bg px-2 py-0.5 text-xs font-medium text-clean">
        clean
      </span>
    );
  }
  return <span className="text-ink-muted">no date announced</span>;
}

export default async function DashboardPage() {
  const session = await requireSession();
  let installationIds: number[];
  try {
    installationIds = await getUserInstallationIds(session.token);
  } catch {
    // token expired or revoked; a fresh sign-in mints a new one
    redirect("/api/auth/login");
  }

  if (installationIds.length === 0) {
    const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
    return (
      <section className="max-w-xl">
        <h1 className="text-3xl">Nothing to watch yet</h1>
        <p className="mt-3 text-ink-secondary">
          aidep scans your repos for OpenAI, Anthropic, and Google deprecations and opens the
          migration PR before calls start failing. Install the GitHub App on a repo to get your
          first audit.
        </p>
        {slug ? (
          <a
            href={`https://github.com/apps/${slug}/installations/new`}
            className="mt-6 inline-block bg-ink px-4 py-2 text-sm text-paper"
          >
            Install the GitHub App
          </a>
        ) : (
          <p className="mt-6 text-sm text-ink-muted">
            <a href="#">Install the GitHub App</a> (set NEXT_PUBLIC_GITHUB_APP_SLUG to make this
            link work)
          </p>
        )}
      </section>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const repos = await repoIndex(installationIds, today);

  return (
    <section>
      <h1 className="text-3xl">Repositories</h1>
      {repos.length === 0 ? (
        <p className="mt-3 text-ink-secondary">
          No repos synced yet. aidep picks them up moments after the App install lands.
        </p>
      ) : (
        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs text-ink-muted">
              <th className="py-2 pr-4 font-normal">repository</th>
              <th className="py-2 pr-4 font-normal">exposures</th>
              <th className="py-2 pr-4 font-normal">next death</th>
              <th className="py-2 font-normal">open PRs</th>
            </tr>
          </thead>
          <tbody>
            {repos.map((r) => (
              <tr key={`${r.owner}/${r.name}`} className="border-b border-rule">
                <td className="py-4 pr-4">
                  <Link
                    href={`/dashboard/${r.owner}/${r.name}`}
                    className="text-link hover:underline"
                  >
                    {r.owner}/{r.name}
                  </Link>
                  <span className="ml-2 text-xs text-ink-muted">
                    {r.private ? "private" : "public"}
                  </span>
                </td>
                <td className="py-4 pr-4 tabular-nums">{r.open_findings}</td>
                <td className="py-4 pr-4">{deathCell(r, today)}</td>
                <td className="py-4 tabular-nums">{r.open_prs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
