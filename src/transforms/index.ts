/**
 * Automatic transforms for one deprecation event across its affected files.
 * Honest scope: string swaps and the textbook Assistants->Responses shapes;
 * anything unrecognized degrades to a checklist item, never a guess.
 */

import type { RegistryRow } from "../registry.ts";
import { ID_BOUNDARY_LEFT, ID_BOUNDARY_RIGHT, PARAM_MODEL_GATE } from "../scanner/patterns.ts";
import { mdEscape } from "../scanner/report.ts";
import { transformAssistants } from "./assistants.ts";
import { removeSamplingParams } from "./params.ts";
import type {
  ChecklistItem,
  EventFileInput,
  EventTransformResult,
  FileTransform,
  TransformForEvent,
} from "./types.ts";

const SAMPLING_PARAMS = ["temperature", "top_p", "top_k"];
const ASSISTANTS_ROW_ID = "openai:endpoint:assistants-api";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Boundary-guarded id regex; same rule as the scanner, so "gpt-4-turbo"
 * never rewrites inside "gpt-4-turbo-preview". */
function idRegex(id: string): RegExp {
  return new RegExp(ID_BOUNDARY_LEFT + escapeRegExp(id) + ID_BOUNDARY_RIGHT, "g");
}

/** "anthropic:model:claude-sonnet-4-6" and bare "claude-sonnet-4-6" both
 * resolve to the model id (mirrors the report's slug()). */
function replacementModel(replacementId: string): string {
  const parts = replacementId.split(":");
  return parts[parts.length - 1];
}

function untouchedFile(f: EventFileInput): FileTransform {
  return { path: f.path, migrated: null, applied: [], checklist: [], swaps: [] };
}

function modelEvent(event: RegistryRow, files: EventFileInput[]): EventTransformResult {
  const eventChecklist: ChecklistItem[] = [];
  const newModel = event.replacement_id === null ? null : replacementModel(event.replacement_id);
  let anyHit = false;
  let anySwap = false;

  const outFiles = files.map((f) => {
    const ft = untouchedFile(f);
    let content = f.content;
    let touched = false;
    for (const id of event.api_ids) {
      if (!idRegex(id).test(content)) continue;
      anyHit = true;
      if (newModel === null) continue;
      content = content.replace(idRegex(id), newModel);
      touched = true;
      anySwap = true;
      ft.swaps.push({ old: id, new: newModel });
      ft.applied.push({ kind: "model-swap", description: `swapped ${id} to ${newModel} in ${f.path}` });
    }
    if (touched && newModel !== null && PARAM_MODEL_GATE.test(newModel)) {
      // the swap landed on a Claude 4.7+ model: non-default sampling params 400
      const removal = removeSamplingParams(content, SAMPLING_PARAMS);
      if (removal.removed.length > 0) {
        content = removal.content;
        const dropped = [...new Set(removal.removed.map((r) => r.param))];
        for (const r of removal.removed) {
          ft.applied.push({ kind: "param-drop", description: `dropped ${r.param} (line ${r.line}) in ${f.path}` });
        }
        ft.checklist.push({
          id: "model-params-dropped",
          text: `Dropped ${dropped.join("/")} in ${mdEscape(f.path)}: non-default sampling params return 400 on Claude 4.7+ models (${newModel}).`,
        });
      }
      for (const b of removal.blocked) {
        ft.checklist.push({
          id: "param-manual",
          text: `${b.param} at ${mdEscape(f.path)}:${b.line} has a computed or multi-line value; remove it manually, it will 400 on ${newModel}.`,
        });
      }
    }
    if (touched) ft.migrated = content;
    return ft;
  });

  if (newModel === null && anyHit) {
    const candidates = event.replacement_notes === null ? "" : `; candidates: ${event.replacement_notes}`;
    eventChecklist.push({
      id: "model-pick-replacement",
      text: `pick a replacement for ${event.api_ids.join("/")}${candidates}`,
    });
  }
  if (anySwap && event.replacement_notes !== null && event.replacement_notes.includes("reasoning.mode: pro")) {
    eventChecklist.push({
      id: "model-reasoning-mode-pro",
      text: `Set reasoning: {"mode": "pro"} (reasoning.mode, per your SDK's spelling) on the swapped ${newModel} calls to keep pro-grade reasoning; aidep does not auto-edit call config for this.`,
    });
  }

  return { files: outFiles, eventChecklist, generatedFiles: [] };
}

function paramEvent(event: RegistryRow, files: EventFileInput[]): EventTransformResult {
  const outFiles = files.map((f) => {
    const ft = untouchedFile(f);
    // only files pinning a Claude 4.7+/5+ model are a live deprecation
    if (!PARAM_MODEL_GATE.test(f.content)) return ft;
    const removal = removeSamplingParams(f.content, event.api_ids);
    if (removal.removed.length > 0) {
      ft.migrated = removal.content;
      for (const r of removal.removed) {
        ft.applied.push({ kind: "param-drop", description: `removed ${r.param} (line ${r.line}) in ${f.path}` });
      }
    }
    for (const b of removal.blocked) {
      ft.checklist.push({
        id: "param-manual",
        text: `${b.param} at ${mdEscape(f.path)}:${b.line} has a computed or multi-line value; remove it manually, non-default sampling params return 400 on Claude 4.7+ models.`,
      });
    }
    return ft;
  });
  return { files: outFiles, eventChecklist: [], generatedFiles: [] };
}

export const transformForEvent: TransformForEvent = (event, files) => {
  let result: EventTransformResult;
  switch (event.surface) {
    case "model":
      result = modelEvent(event, files);
      break;
    case "param":
      result = paramEvent(event, files);
      break;
    case "endpoint":
      result =
        event.id === ASSISTANTS_ROW_ID
          ? transformAssistants(event, files)
          : { files: files.map(untouchedFile), eventChecklist: [], generatedFiles: [] };
      break;
    default:
      result = { files: files.map(untouchedFile), eventChecklist: [], generatedFiles: [] };
  }
  if (event.dies_is_earliest_possible) {
    result.eventChecklist.push({
      id: "earliest-possible-date",
      text: `${event.dies ?? "The listed date"} is the provider's earliest-possible shutdown date; the actual date may be later. Re-check ${event.source_url} before scheduling around it.`,
    });
  }
  return result;
};
