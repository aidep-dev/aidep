import { loadRegistry } from "../../../src/registry.ts";

/**
 * The registry as one JSON array, for other people's agents. Every row
 * carries source_url and verified_at, so a consumer can audit any claim
 * without trusting us. The poller merges at most once a day, so an hour of
 * cache is well inside the freshness the data actually has.
 */
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const rows = await loadRegistry();
  return Response.json(rows, {
    headers: {
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
