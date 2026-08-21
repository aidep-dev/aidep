import { z } from "zod";
import { confirmAddress, confirmTokenMatches } from "../../../../src/notify.ts";

/**
 * The link in the one confirmation mail. A valid HMAC for the address marks
 * it confirmed; after that, and only after that, digests and waitlist mail
 * go to it. Plain text back: nobody needs a page for this.
 */
const Query = z.object({ e: z.string().email().max(200), t: z.string().min(1).max(200) });

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = Query.safeParse({ e: url.searchParams.get("e"), t: url.searchParams.get("t") });
  if (!q.success || !confirmTokenMatches(q.data.e, q.data.t)) {
    return new Response("that link is not valid", { status: 400 });
  }
  await confirmAddress(q.data.e);
  return new Response(
    `Confirmed. aidep will write to ${q.data.e.toLowerCase()} when a scan finds a new exposure or a retirement date gets close, and for nothing else. Remove the address from .github/aidep.json to stop.\n`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
