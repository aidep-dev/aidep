import { z } from "zod";
import { sql } from "../../../src/db/index.ts";

// Fake-door signal store: who clicked upgrade/waitlist before billing exists.
const Body = z.object({
  source: z.enum(["pricing-upgrade", "landing-waitlist", "private-gate"]),
  email: z.string().email().max(200).optional(),
  context: z.string().max(2000).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const { source, email, context } = parsed.data;
  // ponytail: throttle duplicates per (source,email) to one an hour. Schema is
  // owned elsewhere, so no unique index; a single existence check does it.
  // Skip on hit and still return ok, so we never leak that the row existed.
  const recent = await sql`
    select 1 from interest
    where source = ${source} and email is not distinct from ${email ?? null}
      and created_at > now() - interval '1 hour'
    limit 1`;
  if (recent.length === 0) {
    await sql`
      insert into interest (source, email, context)
      values (${source}, ${email ?? null}, ${context ?? null})`;
  }
  return Response.json({ ok: true });
}
