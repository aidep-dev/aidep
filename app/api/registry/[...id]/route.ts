import { replacementChain } from "../../../../src/chain.ts";
import { loadRegistry } from "../../../../src/registry.ts";

/**
 * One id in, its fate out: the row, the replacement chain walked to the end,
 * and whether the id is alive. The one call an agent should make before it
 * recommends a model. Catch-all so "/v1/assistants" resolves as an id.
 */
export const revalidate = 3600;

const FILE_A_ROW = "https://github.com/aidep-dev/aidep-registry/issues/new?template=file-a-row.yml";

const HEADERS = {
  "cache-control": "public, max-age=3600",
  "access-control-allow-origin": "*",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string[] }> },
): Promise<Response> {
  const query = (await params).id.map(decodeURIComponent).join("/");
  const rows = await loadRegistry();
  // endpoint ids carry a leading slash ("/v1/assistants") that a URL path cannot
  let chain = replacementChain(rows, query);
  if (chain.hops.length === 0) chain = replacementChain(rows, `/${query}`);
  if (chain.hops.length === 0) {
    return Response.json(
      { query, found: false, alive: null, file_a_row: FILE_A_ROW },
      { status: 404, headers: HEADERS },
    );
  }
  const [row] = chain.hops;
  const today = new Date().toISOString().slice(0, 10);
  // alive means calls still work today: no retirement yet, or a date still ahead
  const alive = row.status !== "retired" && (row.dies === null || row.dies > today);
  return Response.json(
    {
      query: chain.query,
      found: true,
      alive,
      row,
      chain: chain.hops.map((r) => ({ api_id: r.api_ids[0], status: r.status, dies: r.dies, source_url: r.source_url })),
      end: chain.end,
      cycle: chain.cycle,
    },
    { headers: HEADERS },
  );
}
