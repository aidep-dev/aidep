import type { RegistryRow } from "../../../src/registry.ts";

/** Lowercase alphanumerics only, so "claude 3.5 sonnet" and "claude-3-5-sonnet-20241022" compare on the same footing. */
export function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface Suggestion {
  row: RegistryRow;
  /** the api id on the row that matched, which is what gets filled into the box */
  apiId: string;
}

/* Match tiers, best first. Within a tier the shorter id wins: the id nearest
 * the typed length is the one the reader most likely meant. */
const EXACT = 0;
const PREFIX = 1;
const SUBSTRING = 2;
const TOKENS_IN_ORDER = 3;

function tier(query: string, tokens: string[], id: string): number | null {
  if (id === query) return EXACT;
  if (id.startsWith(query)) return PREFIX;
  if (id.includes(query)) return SUBSTRING;
  let at = 0;
  for (const t of tokens) {
    const i = id.indexOf(t, at);
    if (i === -1) return null;
    at = i + t.length;
  }
  return TOKENS_IN_ORDER;
}

/** The rows a typed string most likely means, best first, one entry per row. */
export function suggest(rows: RegistryRow[], raw: string, limit = 6): Suggestion[] {
  const query = fold(raw);
  if (query === "") return [];
  const tokens = raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hits: Array<Suggestion & { tier: number }> = [];
  for (const row of rows) {
    let best: { apiId: string; tier: number } | null = null;
    for (const apiId of row.api_ids) {
      const t = tier(query, tokens, fold(apiId));
      if (t === null) continue;
      if (best === null || t < best.tier || (t === best.tier && apiId.length < best.apiId.length)) best = { apiId, tier: t };
    }
    if (best !== null) hits.push({ row, apiId: best.apiId, tier: best.tier });
  }
  return hits
    .sort((a, b) => a.tier - b.tier || a.apiId.length - b.apiId.length || a.apiId.localeCompare(b.apiId))
    .slice(0, limit)
    .map(({ row, apiId }) => ({ row, apiId }));
}
