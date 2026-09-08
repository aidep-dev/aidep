import { after } from "next/server.js";
import { z } from "zod";
import { getSessionFromCookies, requireRepoAccess } from "../../../../../src/auth/access.ts";
import { DEFAULT_CONFIG } from "../../../../../src/config.ts";
import { drain, enqueue } from "../../../../../src/jobs.ts";
import { migrationCapBlock, runJob } from "../../../../../src/pipeline.ts";
import { RegistryRowSchema } from "../../../../../src/registry.ts";

const Body = z.object({ registryId: RegistryRowSchema.shape.id });

/** Same post-response drain as the webhook route: outside a Next request
 * scope (plain vitest) after() throws; there we skip the drain entirely so
 * tests can assert the queued job. The cron drain covers missed kicks. */
function kick(): void {
  try {
    after(() => drain(runJob));
  } catch {
    if (!process.env.VITEST) void drain(runJob).catch(() => {});
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> },
): Promise<Response> {
  const session = getSessionFromCookies(req.headers.get("cookie"));
  if (!session) return new Response("unauthorized", { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid registryId" }, { status: 400 });

  const repoId = Number((await params).repoId);
  const { repo, allowed } = await requireRepoAccess(session, repoId);
  if (!repo || !allowed) return new Response("forbidden", { status: 403 });

  // Nothing but the onboarding PR until it merges. The job checks too, so a
  // request queued before this guard cannot outrun it.
  if (repo.onboarded_at === null) {
    return Response.json(
      { error: "Merge the onboarding PR first; aidep opens nothing else until then." },
      { status: 409 },
    );
  }

  // Answered here, not only in the job, so a capped request gets a reason
  // instead of a button that appears to work and then does nothing.
  const capped = await migrationCapBlock(
    repoId,
    repo.config ?? DEFAULT_CONFIG,
    parsed.data.registryId,
  );
  if (capped !== null) return Response.json({ error: capped }, { status: 409 });

  // Migration PRs are free on every repo, public or private. The paid line is
  // the eval pack, gated in evalPackFor where the pack is actually built.
  await enqueue("create_migration_pr", { repoId, registryId: parsed.data.registryId });
  kick();
  return Response.json({ enqueued: true });
}
