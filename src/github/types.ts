/**
 * Minimal structural octokit surface the app code depends on. A real
 * installation Octokit satisfies it; tests inject a recorder.
 */
export interface OctokitLike {
  request(route: string, params?: Record<string, unknown>): Promise<{ data: unknown; status?: number }>;
}

export interface RepoTarget {
  owner: string;
  name: string;
  defaultBranch: string;
}
