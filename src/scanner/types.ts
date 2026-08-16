import type { RegistryRow } from "../registry.ts";

/**
 * One exposure hit. We persist findings only, never source text: `matched` is
 * the identifier that hit (a model ID, an API surface pattern name, an env var
 * name), not the line it appeared on.
 */
export interface Finding {
  /** registry row id, e.g. "openai:endpoint:assistants-api" */
  registryId: string;
  surface: RegistryRow["surface"];
  provider: RegistryRow["provider"];
  path: string;
  /** 1-based */
  line: number;
  matched: string;
  replacementId: string | null;
  dies: string | null;
  diesIsEarliestPossible: boolean;
  status: RegistryRow["status"];
  migrationUrl: string | null;
}

export interface ScanFile {
  path: string;
  text: string;
}

export interface ScanResult {
  findings: Finding[];
  filesScanned: number;
  filesSkipped: number;
}
