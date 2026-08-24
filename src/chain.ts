import type { RegistryRow } from "./registry.ts";

/**
 * Replacement chains over the registry. Pure functions over a row array so
 * the browser can run them against /api/registry and the lookup route can
 * run them on the server; no node imports here.
 *
 * replacement_id is a bare api id ("gpt-4o-mini"), never a registry id, so
 * every lookup goes through api_ids. Every row in the registry is legacy,
 * deprecated or retired: a replacement that resolves to a row is dying too.
 */

export interface Chain {
  query: string;
  /** rows walked, starting at the queried one; empty when the query is unknown */
  hops: RegistryRow[];
  /** where the walk stopped: an id the registry does not have (alive as far as we know), or null when the last hop names no replacement */
  end: { api_id: string; known: false } | null;
  cycle: boolean;
}

export function findRow(rows: RegistryRow[], apiId: string): RegistryRow | undefined {
  const hits = rows.filter((r) => r.api_ids.includes(apiId) || r.id === apiId);
  // "babbage-002" is both a model row and a fine-tuning feature row; a
  // replacement_id names the model, so that row wins when both match
  return hits.find((r) => r.surface === "model") ?? hits[0];
}

export function replacementChain(rows: RegistryRow[], apiId: string): Chain {
  const hops: RegistryRow[] = [];
  const seen = new Set<string>();
  let next: string | null = apiId;
  while (next !== null) {
    const row = findRow(rows, next);
    if (row === undefined) return { query: apiId, hops, end: { api_id: next, known: false }, cycle: false };
    if (seen.has(row.id)) return { query: apiId, hops, end: null, cycle: true };
    seen.add(row.id);
    hops.push(row);
    next = row.replacement_id;
  }
  return { query: apiId, hops, end: null, cycle: false };
}

/** Rows whose named replacement is itself a registry row. */
export function rottedRows(rows: RegistryRow[]): Array<{ row: RegistryRow; replacement: RegistryRow }> {
  const out: Array<{ row: RegistryRow; replacement: RegistryRow }> = [];
  for (const row of rows) {
    if (row.replacement_id === null) continue;
    const replacement = findRow(rows, row.replacement_id);
    if (replacement !== undefined) out.push({ row, replacement });
  }
  return out;
}
