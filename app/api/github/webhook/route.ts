import { after } from "next/server.js";
import { getApp } from "../../../../src/github/app.ts";
import { registerHandlers } from "../../../../src/github/handlers.ts";
import { drain } from "../../../../src/jobs.ts";
import { runJob } from "../../../../src/pipeline.ts";

/** Schedule the queue drain post-response. Outside a Next request scope
 * (plain vitest) after() throws; there we skip the drain entirely; a
 * fallback drain in tests would claim other test files' queued jobs. The
 * cron drain covers anything a missed kick leaves behind. */
function kick(): void {
  try {
    after(() => drain(runJob));
  } catch {
    if (!process.env.VITEST) void drain(runJob).catch(() => {});
  }
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const app = getApp();
  registerHandlers(app); // idempotent per App instance

  // Verify the signature on its own so a handler that throws can't be reported
  // as a bad signature. A bad signature is 401 (GitHub drops it); a handler
  // failure is 500, which shows red in the delivery log. GitHub does not
  // redeliver on its own, so the log line below is how a lost delivery gets
  // noticed and redelivered by hand.
  let signatureOk = false;
  try {
    signatureOk = await app.webhooks.verify(body, req.headers.get("x-hub-signature-256") ?? "");
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return new Response("bad signature", { status: 401 });

  const delivery = req.headers.get("x-github-delivery") ?? "";
  const event = req.headers.get("x-github-event") ?? "";
  try {
    await app.webhooks.receive({
      id: delivery,
      // GitHub sends the event name; receive validates it
      name: event as never,
      payload: JSON.parse(body) as never,
    });
  } catch (e) {
    console.error(`webhook ${event} ${delivery} failed:`, e);
    return new Response("handler error", { status: 500 });
  }

  kick();
  return new Response("ok");
}
