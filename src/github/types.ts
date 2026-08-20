/**
 * Minimal structural octokit surface the app code depends on. A real
 * installation Octokit satisfies it; tests inject a recorder.
 */
export interface OctokitLike {
  /* This is the GitHub REST surface itself, roughly 200 routes whose params and
   * response bodies differ per route. There is no single domain type to accept
   * or return here; each of the 21 call sites narrows its own `data`. */
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
  request(route: string, params?: Record<string, unknown>): Promise<{ data: unknown; status?: number }>;
}

export interface RepoTarget {
  owner: string;
  name: string;
  defaultBranch: string;
}
