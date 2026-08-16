import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getUserInstallationIds } from "../../../../../src/auth/session.ts";
import { getRepoByFullName } from "../../../../../src/db/index.ts";
import { loadRegistry, type RegistryRow } from "../../../../../src/registry.ts";
import {
  daysUntil,
  groupByEvent,
  repoFindings,
  type EventGroup,
} from "../../../../../src/dashboard/queries.ts";
import { requireSession } from "../../../auth.ts";
import CreatePrButton from "../../CreatePrButton.tsx";

const WORKFLOW_PREFIX = ".github/workflows/";

function eventChip(g: EventGroup, reg: RegistryRow | undefined, today: string): ReactNode {
  const dies = g.findings[0].dies;
  if (reg?.status === "retired" || (dies !== null && dies <= today)) {
    return (
      <span className="inline-block rounded-sm bg-dead-bg px-2 py-0.5 text-xs font-medium text-dead">
        calls fail today
      </span>
    );
  }
  if (dies !== null) {
    const d = daysUntil(dies, today);
    return (
      <span className="inline-flex items-baseline gap-2">
        <span className="inline-block rounded-sm bg-dying-bg px-2 py-0.5 text-xs font-medium text-dying">
          {d === 1 ? "1 day" : `${d} days`}
        </span>
        <span className="text-xs text-ink-secondary">{dies}</span>
      </span>
    );
  }
  return <span className="text-xs text-ink-muted">no date announced</span>;
}

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const session = await requireSession();
  const row = await getRepoByFullName(owner, repo);
  if (!row) notFound();
  let installationIds: number[];
  try {
    installationIds = await getUserInstallationIds(session.token);
  } catch {
    redirect("/api/auth/login");
  }
  // bigint columns come back as strings at runtime; compare numerically
  if (!installationIds.includes(Number(row.installation_id))) notFound();

  const [findings, registry] = await Promise.all([
    repoFindings(Number(row.id)),
    // a registry fetch hiccup should not take the dashboard down
    loadRegistry().catch(() => [] as RegistryRow[]),
  ]);
  const groups = groupByEvent(findings);
  const regById = new Map(registry.map((r) => [r.id, r]));
  const today = new Date().toISOString().slice(0, 10);
  const fullName = `${owner}/${repo}`;

  const cfg = row.config;
  const summary = cfg
    ? `${row.default_branch} · ${cfg.schedule} scans · evals ${cfg.evals ? "on" : "off"} · PR cap ${cfg.prCap}`
    : `${row.default_branch} · not onboarded yet`;

  return (
    <section>
      <h1 className="text-3xl">{fullName}</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        {summary}
        {!cfg && row.onboarding_pr_number && (
          <>
            {" · "}
            <a
              href={`https://github.com/${fullName}/pull/${row.onboarding_pr_number}`}
              className="underline decoration-rule underline-offset-2"
            >
              onboarding PR #{row.onboarding_pr_number}
            </a>
          </>
        )}
      </p>

      {groups.length === 0 ? (
        <div className="mt-10 max-w-xl">
          <span className="inline-block rounded-sm bg-clean-bg px-2 py-0.5 text-xs font-medium text-clean">
            clean
          </span>
          <p className="mt-3 text-ink-secondary">
            No open exposures. aidep rescans on every push to {row.default_branch} and whenever the
            deprecation registry changes; anything new shows up here.
          </p>
        </div>
      ) : (
        groups.map((g) => {
          const reg = regById.get(g.registryId);
          const [provider, , slug] = g.registryId.split(":");
          const earliest = g.findings.some((f) => f.dies_is_earliest);
          const replacement = reg?.replacement_id ?? g.findings[0].replacement_id;
          return (
            <section key={g.registryId} className="mt-12">
              <div className="flex flex-wrap items-baseline gap-3 border-b border-rule pb-2">
                <h2 className="text-xl">{slug ?? g.registryId}</h2>
                <span className="text-sm text-ink-muted">{reg?.provider ?? provider}</span>
                {eventChip(g, reg, today)}
                {earliest && (
                  <span className="text-xs text-ink-muted">(earliest possible date)</span>
                )}
              </div>

              {(replacement || reg?.replacement_notes || reg?.migration_url) && (
                <p className="mt-2 text-sm text-ink-secondary">
                  {replacement
                    ? `replacement: ${replacement}`
                    : reg?.replacement_notes
                      ? `replacement: ${reg.replacement_notes}`
                      : "replacement:"}
                  {reg?.migration_url && (
                    <>
                      {" · "}
                      <a
                        href={reg.migration_url}
                        className="text-link hover:underline"
                      >
                        migration guide
                      </a>
                    </>
                  )}
                </p>
              )}

              <table className="mt-4 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-xs text-ink-muted">
                    <th className="py-1.5 pr-4 font-normal">path</th>
                    <th className="py-1.5 pr-4 font-normal">line</th>
                    <th className="py-1.5 font-normal">matched</th>
                  </tr>
                </thead>
                <tbody>
                  {g.findings.map((f) => (
                    <tr key={f.id} className="border-b border-rule">
                      <td className="py-2.5 pr-4">
                        {f.path}
                        {f.path.startsWith(WORKFLOW_PREFIX) && (
                          <span className="ml-2 text-xs text-ink-muted">
                            manual: aidep PRs never edit workflow files
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">{f.line}</td>
                      <td className="py-2.5 font-mono text-xs">{f.matched}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4">
                {g.pr ? (
                  <a
                    href={`https://github.com/${fullName}/pull/${g.pr.number}`}
                    className="text-sm text-link hover:underline"
                  >
                    PR #{g.pr.number} open · eval: {g.pr.evalStatus}
                  </a>
                ) : (
                  <CreatePrButton
                    repoId={Number(row.id)}
                    registryId={g.registryId}
                    repoFullName={fullName}
                  />
                )}
              </div>
            </section>
          );
        })
      )}
    </section>
  );
}
