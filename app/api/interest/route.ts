import { z } from "zod";
import { sql } from "../../../src/db/index.ts";

// Fake-door signal store: who clicked upgrade/waitlist before billing exists.
const Body = z.object({
  source: z.enum(["pricing-upgrade", "landing-waitlist", "private-gate"]),
  email: z.string().max(200).optional(),
  context: z.string().max(2000).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const { source, email, context } = parsed.data;
  await sql`
    insert into interest (source, email, context)
    values (${source}, ${email ?? null}, ${context ?? null})`;
  return Response.json({ ok: true });
}
