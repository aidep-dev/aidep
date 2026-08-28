import type { RegistryRow } from "../../../src/registry.ts";

/** One register row with everything the page computed for it on the server. */
export interface RegisterEntry {
  row: RegistryRow;
  days: number | null;
  retired: boolean;
  query: string | null;
  files: number | null;
  countedAt: string | null;
  rotted: RegistryRow | null;
}

export interface Filters {
  provider: "all" | "openai" | "anthropic" | "google";
  status: "all" | "dead" | "dying";
  sort: "dies" | "files";
  q: string;
}

/* Retired rows lead, newest death first, so the top of the register is what
 * broke most recently; live rows follow by nearest date. Dateless last in
 * both halves. */
function byDies(a: RegisterEntry, b: RegisterEntry): number {
  if (a.retired !== b.retired) return a.retired ? -1 : 1;
  const ad = a.row.dies;
  const bd = b.row.dies;
  if (ad === null || bd === null) {
    if (ad !== bd) return ad === null ? 1 : -1;
  } else if (ad !== bd) {
    return a.retired ? bd.localeCompare(ad) : ad.localeCompare(bd);
  }
  return a.row.id.localeCompare(b.row.id);
}

function byFiles(a: RegisterEntry, b: RegisterEntry): number {
  if (a.files === null || b.files === null) {
    if (a.files !== b.files) return a.files === null ? 1 : -1;
    return byDies(a, b);
  }
  return b.files - a.files || byDies(a, b);
}

export function applyFilters(entries: RegisterEntry[], f: Filters): RegisterEntry[] {
  const q = f.q.trim().toLowerCase();
  return entries
    .filter(
      (e) =>
        (f.provider === "all" || e.row.provider === f.provider) &&
        (f.status === "all" || e.retired === (f.status === "dead")) &&
        (q === "" ||
          e.row.id.toLowerCase().includes(q) ||
          e.row.api_ids.some((id) => id.toLowerCase().includes(q))),
    )
    .sort(f.sort === "files" ? byFiles : byDies);
}
