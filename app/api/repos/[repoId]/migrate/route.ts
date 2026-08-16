import { after } from "next/server.js";
import { z } from "zod";
import { getSessionFromCookies, requireRepoAccess } from "../../../../../src/auth/access.ts";
import { sql } from "../../../../../src/db/index.ts";
import { drain, enqueue } from "../../../../../src/jobs.ts";
import { runJob } from "../../../../../src/pipeline.ts";
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

  if (repo.private) {
    const [inst] = await sql<{ paid: boolean }[]>`
      select paid from installations where id = ${repo.installation_id}`;
    if (!inst?.paid) {
      return Response.json(
        { error: "paid", message: "Migration PRs on private repos are on the paid plan." },
        { status: 402 },
      );
    }
  }

  await enqueue("create_migration_pr", { repoId, registryId: parsed.data.registryId });
  kick();
  return Response.json({ enqueued: true });
}
