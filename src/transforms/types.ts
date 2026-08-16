import type { RegistryRow } from "../registry.ts";

/** One manual step for the PR body. `text` is our copy; any repo-derived
 * fragment interpolated into it must already be markdown-escaped. */
export interface ChecklistItem {
  id: string;
  text: string;
}

export interface AppliedChange {
  kind: string;
  description: string;
}

export interface FileTransform {
  path: string;
  /** full migrated file content, or null when nothing was auto-changed */
  migrated: string | null;
  applied: AppliedChange[];
  checklist: ChecklistItem[];
  /** rows for the PR body swap table */
  swaps: Array<{ old: string; new: string }>;
}

export interface EventFileInput {
  path: string;
  content: string;
}

export interface EventTransformResult {
  files: FileTransform[];
  /** checklist items that apply to the event as a whole, not one file */
  eventChecklist: ChecklistItem[];
  /** extra generated files to add to the PR (one-off scripts etc.) */
  generatedFiles: Array<{ path: string; content: string }>;
}

/**
 * Apply every automatic transform for one deprecation event across its
 * affected files. Honest scope: pattern rewrites for the idiomatic shapes in
 * OpenAI's own docs; anything unrecognized degrades to a checklist item,
 * never a guess. Implemented in src/transforms/index.ts.
 */
export type TransformForEvent = (
  event: RegistryRow,
  files: EventFileInput[],
  allRows: RegistryRow[],
) => EventTransformResult;
