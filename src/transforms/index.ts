/**
 * Automatic transforms for one deprecation event across its affected files.
 * Honest scope: string swaps and the textbook Assistants->Responses shapes;
 * anything unrecognized degrades to a checklist item, never a guess.
 */

import type { RegistryRow } from "../registry.ts";
import { PARAM_MODEL_GATE } from "../scanner/patterns.ts";
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

// Transform-local id boundary. Stricter than the scanner's: it also refuses a
// "/" neighbour so an id inside https://.../models/<id> or evals/<id>/x is
// never auto-rewritten. The scanner keeps its own looser boundary so those
// still surface as findings; aidep just does not edit them.
const TX_BOUNDARY_LEFT = "(?<![A-Za-z0-9._/-])";
const TX_BOUNDARY_RIGHT = "(?![A-Za-z0-9._/-])";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An id with no separator at all (ada, curie, o1): bare, it is as likely an
 * identifier or prose as a model string, so only its quoted form is rewritten. */
function isWordLikeId(id: string): boolean {
  return /^[a-z0-9]+$/i.test(id);
}

function idRegex(id: string): RegExp {
  if (isWordLikeId(id)) return new RegExp(`(?<=(['"]))${escapeRegExp(id)}(?=\\1)`, "g");
  const left = /^[A-Za-z0-9._-]/.test(id) ? TX_BOUNDARY_LEFT : "";
  const right = /[A-Za-z0-9._-]$/.test(id) ? TX_BOUNDARY_RIGHT : "";
  return new RegExp(left + escapeRegExp(id) + right, "g");
}

/** Docs/changelogs are prose, not code: matches there degrade to a checklist
 * item rather than an edit. */
function isDocPath(path: string): boolean {
  return /\.(?:md|markdown|mdx|txt|rst|adoc)$/i.test(path) || /changelog/i.test(path);
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

/**
 * The smallest balanced `(...)` region that contains `target` (0-based line),
 * as [openLine, closeLine] inclusive. Null when the target line has no
 * still-open paren at its end (a fully single-line call); "unbalanced" when
 * one is open there but never closes, so the call's extent is unknown.
 * Callers pass comment-stripped lines. A triple-quoted string or a template
 * literal keeps its quote state across lines, so a paren inside a prompt is
 * never counted; a single ' or " that is still open at a line end is a stray
 * apostrophe and is dropped, so it cannot swallow the rest of the file.
 */
function enclosingParenRange(lines: string[], target: number): [number, number] | null | "unbalanced" {
  const openStack: number[] = []; // line of each still-open "("
  let capturedDepth: number | null = null;
  let capturedOpen: number | null = null;
  let quote: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (quote === '"' || quote === "'") quote = null;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (quote !== null) {
        if (ch === "\\") {
          j++;
          continue;
        }
        if (line.startsWith(quote, j)) {
          j += quote.length - 1;
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        const triple = line.slice(j, j + 3);
        quote = triple === '"""' || triple === "'''" ? triple : ch;
        j += quote.length - 1;
        continue;
      }
      if (ch === "(") {
        openStack.push(i);
        continue;
      }
      if (ch === ")") {
        if (openStack.length === 0) continue;
        openStack.pop();
        // the paren innermost-open at the target line just closed
        if (capturedDepth !== null && openStack.length === capturedDepth - 1) {
          return [capturedOpen!, i];
        }
      }
    }
    if (i === target && capturedDepth === null && openStack.length > 0) {
      capturedDepth = openStack.length;
      capturedOpen = openStack[openStack.length - 1];
    }
  }
  return capturedDepth === null ? null : "unbalanced";
}

/** Strip line comments (`#`, `//`) so a commented model mention never reads as
 * real code. Quote-aware; a good-enough heuristic that only ever biases toward
 * a checklist, never toward a wrong edit. */
function stripLineComments(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      let quote: string | null = null;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (quote !== null) {
          if (ch === "\\") {
            j++;
            continue;
          }
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          quote = ch;
          continue;
        }
        if (ch === "#") return line.slice(0, j);
        if (ch === "/" && line[j + 1] === "/") return line.slice(0, j);
      }
      return line;
    })
    .join("\n");
}

const MODEL_PIN_RE = /\bmodel\s*[:=]\s*["']([^"']+)["']/g;

/**
 * Decide whether a param file's sampling args can be auto-removed. Only when
 * every model pinned in real code is gated (Claude 4.7+); a mix of gated and
 * ungated pins, or a gated id that shows up only in a comment, degrades to a
 * checklist so we never strip params from an ungated model's call.
 */
function paramGateDecision(content: string): "none" | "edit" | "manual" {
  const code = stripLineComments(content);
  const pins = [...code.matchAll(MODEL_PIN_RE)].map((m) => m[1]);
  if (pins.length > 0) {
    const gated = pins.filter((m) => PARAM_MODEL_GATE.test(m));
    if (gated.length === 0) return "none";
    return gated.length === pins.length ? "edit" : "manual";
  }
  // no clean string pin: a gated id in real code, or only in a comment, is
  // ambiguous -> hand it to a human
  if (PARAM_MODEL_GATE.test(code)) return "manual";
  if (PARAM_MODEL_GATE.test(content)) return "manual";
  return "none";
}

function modelEvent(event: RegistryRow, files: EventFileInput[]): EventTransformResult {
  const eventChecklist: ChecklistItem[] = [];
  const newModel = event.replacement_id === null ? null : replacementModel(event.replacement_id);
  let anyHit = false;
  let anySwap = false;

  const outFiles = files.map((f) => {
    const ft = untouchedFile(f);

    // docs/changelogs: never edited, matches become a checklist item
    if (isDocPath(f.path)) {
      for (const id of event.api_ids) {
        if (!idRegex(id).test(f.content)) continue;
        anyHit = true;
        const rep = newModel === null ? "" : ` (replacement: ${mdEscape(newModel)})`;
        ft.checklist.push({
          id: "model-doc-mention",
          text: `${mdEscape(f.path)} mentions ${mdEscape(id)}; aidep does not edit docs/changelogs. Update the reference by hand${rep}.`,
        });
      }
      return ft;
    }

    const lines = f.content.split("\n");
    let touched = false;
    const swappedLines = new Set<number>();
    for (const id of event.api_ids) {
      if (!idRegex(id).test(f.content)) continue;
      anyHit = true;
      if (newModel === null) continue;
      if (isWordLikeId(id)) {
        const bareRegex = new RegExp(TX_BOUNDARY_LEFT + escapeRegExp(id) + TX_BOUNDARY_RIGHT, "g");
        const bare = (f.content.match(bareRegex) ?? []).length - (f.content.match(idRegex(id)) ?? []).length;
        if (bare > 0) {
          ft.checklist.push({
            id: "model-bare-id",
            text: `${mdEscape(id)} also appears unquoted ${bare} time${bare === 1 ? "" : "s"} in ${mdEscape(f.path)}; left as is, since bare it may be an identifier or prose. Check each by hand (replacement: ${mdEscape(newModel)}).`,
          });
        }
      }
      let idSwapped = false;
      for (let i = 0; i < lines.length; i++) {
        if (!idRegex(id).test(lines[i])) continue;
        // replacer function: a `$` in the registry's replacement id is literal
        lines[i] = lines[i].replace(idRegex(id), () => newModel);
        swappedLines.add(i);
        idSwapped = true;
      }
      if (idSwapped) {
        touched = true;
        anySwap = true;
        ft.swaps.push({ old: id, new: newModel });
        ft.applied.push({ kind: "model-swap", description: `swapped ${id} to ${newModel} in ${f.path}` });
      }
    }

    let content = lines.join("\n");
    if (touched && newModel !== null && PARAM_MODEL_GATE.test(newModel)) {
      // the swap landed on a Claude 4.7+ model: non-default sampling params
      // 400 - but only for THIS call, so scope removal to the swapped call's
      // enclosing paren region (never file-wide onto other models' calls)
      const allowed = new Set<number>();
      const codeLines = stripLineComments(content).split("\n");
      let unbalanced = false;
      for (const ln of swappedLines) {
        const region = enclosingParenRange(codeLines, ln);
        if (region === "unbalanced") unbalanced = true;
        const [from, to] = Array.isArray(region) ? region : [ln, ln];
        for (let k = from; k <= to; k++) allowed.add(k);
      }
      const removal = removeSamplingParams(content, SAMPLING_PARAMS, allowed);
      // a call whose end was not found may carry params on lines the scoped
      // removal never saw; a file-wide dry run says whether any exist
      const unseen = unbalanced ? removeSamplingParams(content, SAMPLING_PARAMS) : null;
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
      if (unseen !== null && unseen.removed.length + unseen.blocked.length > removal.removed.length + removal.blocked.length) {
        ft.checklist.push({
          id: "param-manual",
          text: `aidep could not find the end of the swapped call in ${mdEscape(f.path)}; check it for temperature/top_p/top_k by hand, non-default values return 400 on ${newModel}.`,
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
    const decision = paramGateDecision(f.content);
    if (decision === "none") return ft;
    if (decision === "manual") {
      ft.checklist.push({
        id: "param-gate-manual",
        text: `${mdEscape(f.path)} references a Claude 4.7+ model but aidep could not confirm every call in it pins one (mixed or comment-only). Remove temperature/top_p/top_k only from the gated calls by hand; non-default values return 400 there.`,
      });
      return ft;
    }
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
