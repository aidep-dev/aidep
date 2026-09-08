/**
 * Assistants API -> Responses/Conversations transforms. Recognized-shape-or-
 * checklist: only the textbook shapes from OpenAI's own migration guide (and
 * our planted fixtures) are rewritten; anything else degrades to a checklist
 * item, never a guess. aidep never emits hosted prompt references; configs
 * are inlined (prompt creation is dashboard-only and /v1/prompts dies
 * 2026-11-30).
 */

import type { RegistryRow } from "../registry.ts";
import type {
  AppliedChange,
  ChecklistItem,
  EventFileInput,
  EventTransformResult,
  FileTransform,
} from "./types.ts";
import { ID_LITERAL_MIN } from "../scanner/patterns.ts";
import { mdEscape } from "../scanner/report.ts";
import { BACKFILL_THREADS_MJS, FETCH_AND_INLINE_MJS } from "./scripts.ts";

type Lang = "py" | "js";

function langOf(path: string): Lang | null {
  if (/\.py$/.test(path)) return "py";
  if (/\.(?:mjs|cjs|js|jsx|ts|tsx|mts)$/.test(path)) return "js";
  return null;
}

// ---------------------------------------------------------------------------
// small parsing helpers (line-oriented, textbook shapes only)

/**
 * From the "(" at lines[startLine][openCol], read to the matching ")" across
 * lines. Returns the argument text between the outer parens, plus the end
 * position. Null when the parens never balance.
 */
function readCall(
  lines: string[],
  startLine: number,
  openCol: number,
): { endLine: number; endCol: number; args: string } | null {
  let depth = 0;
  let quote: string | null = null;
  let args = "";
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (let j = i === startLine ? openCol : 0; j < line.length; j++) {
      const ch = line[j];
      if (quote !== null) {
        if (ch === "\\") {
          args += ch + (line[j + 1] ?? "");
          j++;
          continue;
        }
        if (ch === quote) quote = null;
        args += ch;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        if (depth > 0) args += ch;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        if (depth > 0) args += ch;
        depth++;
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0 && ch === ")") return { endLine: i, endCol: j, args };
        if (depth > 0) args += ch;
        continue;
      }
      if (depth > 0) args += ch;
    }
    if (depth > 0) args += "\n";
  }
  return null;
}

/** Split on commas at bracket depth 0, respecting quotes. Trims entries. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let j = 0; j < text.length; j++) {
    const ch = text[j];
    if (quote !== null) {
      cur += ch;
      if (ch === "\\") {
        cur += text[j + 1] ?? "";
        j++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** `name=expr` python kwargs. Null on any positional arg. */
function parseKwargs(args: string): Map<string, string> | null {
  const map = new Map<string, string>();
  for (const part of splitTopLevel(args)) {
    const m = /^(\w+)\s*=\s*([\s\S]+)$/.exec(part);
    if (m === null) return null;
    map.set(m[1], m[2].trim());
  }
  return map;
}

/** `{ key: value }` / `{"key": value}` object literals. Null when not one. */
function parseObjectProps(objText: string): Map<string, string> | null {
  const t = objText.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  const map = new Map<string, string>();
  for (const part of splitTopLevel(t.slice(1, -1))) {
    const m = /^(["']?)([\w$]+)\1\s*:\s*([\s\S]+)$/.exec(part);
    if (m === null) return null;
    map.set(m[2], m[3].trim());
  }
  return map;
}

function stripQuotes(s: string | undefined): string | null {
  if (s === undefined) return null;
  const m = /^["'](.*)["']$/.exec(s.trim());
  return m === null ? null : m[1];
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// function segmentation

interface FnRange {
  /** line of `def` / `function` header */
  header: number;
  /** first body line (py) / header line (js) */
  start: number;
  /** last body line (py) / closing-brace line (js), inclusive */
  end: number;
  indent: string;
  name: string | null;
}

function indentOf(line: string): string {
  return /^\s*/.exec(line)![0];
}

function pyFunctions(lines: string[]): FnRange[] {
  const out: FnRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
    if (m === null) continue;
    const indent = m[1];
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      if (indentOf(lines[j]).length <= indent.length) {
        end = j - 1;
        break;
      }
      end = j;
    }
    while (end > i && lines[end].trim() === "") end--;
    out.push({ header: i, start: i + 1, end, indent, name: m[2] });
    // skip nested defs inside this body: they would otherwise be emitted as
    // overlapping ranges and a nested dance would be matched (and rewritten)
    // twice (mirror jsFunctions)
    i = end;
  }
  return out;
}

/** Find the line of the `}` closing the first `{` at/after startLine. */
function findBlockEnd(lines: string[], startLine: number): number | null {
  let depth = 0;
  let started = false;
  let quote: string | null = null;
  let inBlockComment = false;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inBlockComment) {
        if (ch === "*" && line[j + 1] === "/") {
          inBlockComment = false;
          j++;
        }
        continue;
      }
      if (quote !== null) {
        if (ch === "\\") j++;
        else if (ch === quote) quote = null;
        continue;
      }
      // braces inside comments are not structure
      if (ch === "/" && line[j + 1] === "/") break;
      if (ch === "/" && line[j + 1] === "*") {
        inBlockComment = true;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") {
        depth++;
        started = true;
        continue;
      }
      if (ch === "}") {
        depth--;
        if (started && depth === 0) return i;
      }
    }
  }
  return null;
}

function jsFunctions(lines: string[]): FnRange[] {
  const out: FnRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m =
      /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(/.exec(lines[i]) ??
      /^(\s*)(?:export\s+)?const\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\s*)?\(/.exec(lines[i]);
    if (m === null) continue;
    const end = findBlockEnd(lines, i);
    if (end === null) continue;
    out.push({ header: i, start: i, end, indent: m[1], name: m[2] });
    i = end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// edit operations, applied bottom-up so earlier indices stay valid

type Op =
  | { kind: "replace"; start: number; end: number; block: string[] }
  | { kind: "delete"; start: number; end: number; collapseBlank?: boolean }
  | { kind: "patch"; line: number; apply: (s: string) => string };

function opStart(op: Op): number {
  return op.kind === "patch" ? op.line : op.start;
}

function applyOps(lines: string[], ops: Op[]): string[] {
  const out = [...lines];
  const sorted = [...ops].sort((a, b) => opStart(b) - opStart(a));
  for (const op of sorted) {
    if (op.kind === "patch") {
      out[op.line] = op.apply(out[op.line]);
      continue;
    }
    let end = op.end;
    if (
      op.kind === "delete" &&
      op.collapseBlank === true &&
      op.start > 0 &&
      out[op.start - 1].trim() === "" &&
      end + 1 < out.length &&
      out[end + 1].trim() === ""
    ) {
      end++; // the two blank lines around the removed block collapse to one
    }
    out.splice(op.start, end - op.start + 1, ...(op.kind === "replace" ? op.block : []));
  }
  return out;
}

// ---------------------------------------------------------------------------
// the 4-call dance

// the receiver capture starts at a token edge: without the lookbehind the
// greedy `[\w.$]+` retries from every char of a long identifier run and the
// scan of a 1 MB line takes minutes
const RE_MSG_CREATE = /(?<![\w.$])([\w.$]+)\.beta\.threads\.messages\.create\(/;
const RE_RUNS = /(?<![\w.$])([\w.$]+)\.beta\.threads\.runs\.(create_and_poll|createAndPoll|create)\(/;
const RE_RETRIEVE = /\.beta\.threads\.runs\.retrieve\(/;
const RE_MSG_LIST = /\.beta\.threads\.messages\.list\(/;
const RE_WHILE_PY = /^(\s*)while\s+[\w.]+\.status\b/;
const RE_WHILE_JS = /^(\s*)while\s*\(/;

interface Span {
  start: number;
  end: number;
}

interface Dance {
  msgCreate: Span;
  indent: string;
  prefix: string;
  runs: Span;
  poll: Span | null;
  msgList: Span;
  thread: string;
  role: string;
  content: string;
  /** py only: the dance calls were awaited (async def), so the emitted
   * responses.create is awaited too. js always awaits. */
  isAsync: boolean;
  patches: Op[];
}

type DanceResult = { ok: true; dance: Dance } | { ok: false; detail: string } | null;

function inSpan(i: number, spans: Array<Span | null>): boolean {
  return spans.some((s) => s !== null && i >= s.start && i <= s.end);
}

/** Which of the 4 calls appear in the body, for checklist copy. */
function seenCalls(lines: string[], from: number, to: number): string[] {
  const seen: string[] = [];
  const text = lines.slice(from, to + 1).join("\n");
  if (RE_MSG_CREATE.test(text)) seen.push("messages.create");
  if (RE_RUNS.test(text)) seen.push("runs.create");
  if (RE_RETRIEVE.test(text)) seen.push("runs.retrieve (poll)");
  if (RE_MSG_LIST.test(text)) seen.push("messages.list");
  return seen;
}

function missingCalls(seen: string[]): string[] {
  return ["messages.create", "runs.create", "runs.retrieve (poll)", "messages.list"].filter(
    (c) => !seen.includes(c),
  );
}

function recognizeDance(lines: string[], fn: FnRange, lang: Lang): DanceResult {
  const from = lang === "py" ? fn.start : fn.start + 1;
  const to = lang === "py" ? fn.end : fn.end - 1;
  const seen = seenCalls(lines, from, to);
  if (seen.length === 0) return null;
  const fail = (detail: string): DanceResult => ({ ok: false, detail });

  // locate single occurrences
  const find = (re: RegExp): number[] => {
    const hits: number[] = [];
    for (let i = from; i <= to; i++) if (re.test(lines[i])) hits.push(i);
    return hits;
  };
  const mcHits = find(RE_MSG_CREATE);
  const runHits = find(RE_RUNS);
  const listHits = find(RE_MSG_LIST);
  const missing = missingCalls(seen);
  if (mcHits.length === 0 || runHits.length === 0 || listHits.length === 0) {
    return fail(`saw ${seen.join(", ")}; missing ${missing.join(", ")}`);
  }
  if (mcHits.length > 1) return fail("messages.create appears more than once");
  if (runHits.length > 1) return fail("runs.create appears more than once");
  if (listHits.length > 1) return fail("messages.list appears more than once");

  // messages.create; bare statement, kwargs/props {thread_id?, role, content}
  const mcLine = mcHits[0];
  const mcMatch = RE_MSG_CREATE.exec(lines[mcLine])!;
  const mcPrefixText = lines[mcLine].slice(0, mcMatch.index).trim();
  if (mcPrefixText !== "" && mcPrefixText !== "await") {
    return fail("messages.create is not a bare statement");
  }
  const mcCall = readCall(lines, mcLine, mcMatch.index + mcMatch[0].length - 1);
  if (mcCall === null) return fail("messages.create call did not parse");
  let role: string | undefined;
  let content: string | undefined;
  let mcThread: string | undefined;
  if (lang === "py") {
    const kw = parseKwargs(mcCall.args);
    if (kw === null) return fail("messages.create has positional args");
    for (const k of kw.keys()) {
      if (!["thread_id", "role", "content"].includes(k)) {
        return fail(`messages.create has an unrecognized ${k} arg`);
      }
    }
    role = kw.get("role");
    content = kw.get("content");
    mcThread = kw.get("thread_id");
  } else {
    const args = splitTopLevel(mcCall.args);
    if (args.length !== 2) return fail("messages.create does not take (threadId, {...})");
    const props = parseObjectProps(args[1]);
    if (props === null) return fail("messages.create options are not a literal object");
    for (const k of props.keys()) {
      if (!["role", "content"].includes(k)) {
        return fail(`messages.create has an unrecognized ${k} property`);
      }
    }
    role = props.get("role");
    content = props.get("content");
    mcThread = args[0];
  }
  if (role === undefined || content === undefined) {
    return fail("messages.create is missing role or content");
  }

  // runs.create / create_and_poll / createAndPoll
  const runLine = runHits[0];
  const runMatch = RE_RUNS.exec(lines[runLine])!;
  const runPrefixRe =
    lang === "py"
      ? /^\s*(?:(\w+)\s*=\s*)?(?:await\s+)?$/
      : /^\s*(?:(?:const|let|var)\s+([\w$]+)\s*=\s*)?(?:await\s+)?$/;
  const runPrefix = runPrefixRe.exec(lines[runLine].slice(0, runMatch.index));
  if (runPrefix === null) return fail("runs.create is not a simple statement");
  const runVar = runPrefix[1] ?? null;
  const runCall = readCall(lines, runLine, runMatch.index + runMatch[0].length - 1);
  if (runCall === null) return fail("runs.create call did not parse");
  const polled = runMatch[2] !== "create";
  let runThread: string | undefined;
  if (lang === "py") {
    const kw = parseKwargs(runCall.args);
    if (kw === null) return fail("runs.create has positional args");
    for (const k of kw.keys()) {
      if (!["thread_id", "assistant_id"].includes(k)) {
        return fail(`runs.create has an unrecognized ${k} arg`);
      }
    }
    runThread = kw.get("thread_id");
  } else {
    const args = splitTopLevel(runCall.args);
    if (args.length < 1 || args.length > 2) return fail("runs.create arg shape not recognized");
    if (args.length === 2) {
      const props = parseObjectProps(args[1]);
      if (props === null) return fail("runs.create options are not a literal object");
      for (const k of props.keys()) {
        if (k !== "assistant_id") return fail(`runs.create has an unrecognized ${k} property`);
      }
    }
    runThread = args[0];
  }

  // the poll loop (required with runs.create, absent with create_and_poll)
  let poll: Span | null = null;
  if (!polled) {
    const whileRe = lang === "py" ? RE_WHILE_PY : RE_WHILE_JS;
    const whileHits = find(whileRe);
    if (whileHits.length !== 1) {
      return fail(`saw ${seen.join(", ")}; missing runs.retrieve (poll)`);
    }
    const wLine = whileHits[0];
    let wEnd: number;
    if (lang === "py") {
      const wIndent = indentOf(lines[wLine]);
      wEnd = wLine;
      for (let j = wLine + 1; j <= to; j++) {
        if (lines[j].trim() === "") continue;
        if (indentOf(lines[j]).length <= wIndent.length) break;
        wEnd = j;
      }
    } else {
      const end = findBlockEnd(lines, wLine);
      if (end === null || end > to) return fail("poll loop did not parse");
      wEnd = end;
    }
    const loopText = lines.slice(wLine, wEnd + 1).join("\n");
    if (!RE_RETRIEVE.test(loopText)) return fail("poll loop has no runs.retrieve");
    poll = { start: wLine, end: wEnd };
  } else if (find(RE_RETRIEVE).length > 0) {
    return fail("create_and_poll combined with runs.retrieve");
  }

  // messages.list; assigned to a var
  const listLine = listHits[0];
  const listRe =
    lang === "py"
      ? /^(\s*)(\w+)\s*=\s*(?:await\s+)?([\w.]+)\.beta\.threads\.messages\.list\(/
      : /^(\s*)(?:const|let|var)\s+([\w$]+)\s*=\s*await\s+([\w.$]+)\.beta\.threads\.messages\.list\(/;
  const listMatch = listRe.exec(lines[listLine]);
  if (listMatch === null) return fail("messages.list result is not assigned to a variable");
  const msgVar = listMatch[2];
  const listOpen = lines[listLine].indexOf("(", listMatch.index + listMatch[0].length - 1);
  const listCall = readCall(lines, listLine, listOpen);
  if (listCall === null) return fail("messages.list call did not parse");

  const spans: Array<Span | null> = [
    { start: mcLine, end: mcCall.endLine },
    { start: runLine, end: runCall.endLine },
    poll,
    { start: listLine, end: listCall.endLine },
  ];

  // textbook order: create -> run -> poll -> list
  if (
    !(mcCall.endLine < runLine && runCall.endLine < (poll?.start ?? listLine) && (poll?.end ?? runCall.endLine) < listLine)
  ) {
    return fail("calls are not in the textbook order");
  }

  // the guide's "grab latest message" idioms. The single-message access maps
  // to the scalar response.output_text; the list comprehension returned a
  // list, so it maps to [response.output_text] to keep the caller's type.
  const idioms: Array<{ re: RegExp; replacement: string }> = [
    {
      re: new RegExp(String.raw`${reEscape(msgVar)}\.data\[0\]\.content\[0\]\.text\.value`, "g"),
      replacement: "response.output_text",
    },
  ];
  if (lang === "py") {
    idioms.push({
      re: new RegExp(
        String.raw`\[\s*(\w+)\.content\[0\]\.text\.value\s+for\s+\1\s+in\s+${reEscape(msgVar)}\.data\s*\]`,
        "g",
      ),
      replacement: "[response.output_text]",
    });
  }
  const applyIdioms = (s: string): string =>
    idioms.reduce((acc, idiom) => {
      idiom.re.lastIndex = 0;
      return acc.replace(idiom.re, idiom.replacement);
    }, s);
  const patches: Op[] = [];
  for (let i = from; i <= to; i++) {
    if (inSpan(i, spans)) continue;
    for (const idiom of idioms) {
      idiom.re.lastIndex = 0;
      if (idiom.re.test(lines[i])) {
        patches.push({ kind: "patch", line: i, apply: applyIdioms });
        break;
      }
    }
  }

  // no leftover uses of the run/messages vars may survive the rewrite
  // same `$`-aware boundary as removeCreateOps: `\b` would let `$msgs` slip past
  const leftoverRes = [new RegExp(String.raw`(?<![A-Za-z0-9_$])${reEscape(msgVar)}(?![A-Za-z0-9_$])`)];
  if (runVar !== null) {
    leftoverRes.push(new RegExp(String.raw`(?<![A-Za-z0-9_$])${reEscape(runVar)}(?![A-Za-z0-9_$])`));
  }
  const patchedLines = new Set(patches.map((p) => (p.kind === "patch" ? p.line : -1)));
  for (let i = from; i <= to; i++) {
    if (inSpan(i, spans)) continue;
    const text = patchedLines.has(i) ? applyIdioms(lines[i]) : lines[i];
    for (const re of leftoverRes) {
      if (re.test(text)) return fail("run/messages result is used beyond the recognized idiom");
    }
  }

  const thread = runThread ?? mcThread;
  if (thread === undefined) return fail("could not determine the thread expression");

  return {
    ok: true,
    dance: {
      msgCreate: { start: mcLine, end: mcCall.endLine },
      indent: indentOf(lines[mcLine]),
      prefix: mcMatch[1],
      runs: { start: runLine, end: runCall.endLine },
      poll,
      msgList: { start: listLine, end: listCall.endLine },
      thread,
      role,
      content,
      isAsync: lang === "py" && mcPrefixText === "await",
      patches,
    },
  };
}

interface LiftedConfig {
  model: string;
  instructions: string | null;
  tools: string | null;
}

function danceOps(d: Dance, lang: Lang, lifted: LiftedConfig | null): Op[] {
  const ind = d.indent;
  const block: string[] = [];
  if (lang === "py") {
    const awaitKw = d.isAsync ? "await " : "";
    block.push(`${ind}response = ${awaitKw}${d.prefix}.responses.create(`);
    if (lifted !== null) {
      block.push(`${ind}    model=${lifted.model},`);
      if (lifted.instructions !== null) block.push(`${ind}    instructions=${lifted.instructions},`);
      if (lifted.tools !== null) block.push(`${ind}    tools=${lifted.tools},`);
    }
    block.push(`${ind}    conversation=${d.thread},`);
    block.push(`${ind}    input=[{"role": ${d.role}, "content": ${d.content}}],`);
    block.push(`${ind})`);
  } else {
    block.push(`${ind}const response = await ${d.prefix}.responses.create({`);
    if (lifted !== null) {
      block.push(`${ind}  model: ${lifted.model},`);
      if (lifted.instructions !== null) block.push(`${ind}  instructions: ${lifted.instructions},`);
      if (lifted.tools !== null) block.push(`${ind}  tools: ${lifted.tools},`);
    }
    block.push(`${ind}  conversation: ${d.thread},`);
    block.push(`${ind}  input: [{ role: ${d.role}, content: ${d.content} }],`);
    block.push(`${ind}});`);
  }
  return [
    { kind: "replace", start: d.msgCreate.start, end: d.msgCreate.end, block },
    { kind: "delete", start: d.runs.start, end: d.runs.end },
    ...(d.poll !== null ? [{ kind: "delete", start: d.poll.start, end: d.poll.end } as Op] : []),
    { kind: "delete", start: d.msgList.start, end: d.msgList.end },
    ...d.patches,
  ];
}

// ---------------------------------------------------------------------------
// in-code assistants.create inlining (3c)

const RE_ASSISTANTS_CREATE = /(?<![\w.$])([\w.$]+)\.beta\.assistants\.create\(/;

interface CreateInfo {
  /** null when the call could not even be located as one statement */
  span: Span | null;
  varName: string | null;
  lifted: LiftedConfig | null;
  reason: string | null;
}

const CODE_INTERPRETER_REASON =
  "code_interpreter tools are not auto-translated: the Responses code_interpreter uses a container model with a 20-minute idle expiry";

function translateTools(
  toolsText: string,
  toolResourcesText: string | undefined,
  lang: Lang,
): { text: string | null; error: string | null } {
  const t = toolsText.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return { text: null, error: "tools is not a literal list" };
  let vsIds: string | null = null;
  if (toolResourcesText !== undefined) {
    const tr = parseObjectProps(toolResourcesText);
    if (tr === null) return { text: null, error: "tool_resources is not a literal object" };
    for (const [k, v] of tr) {
      if (k !== "file_search") return { text: null, error: `tool_resources.${k} is not auto-translated` };
      const fs = parseObjectProps(v);
      const ids = fs?.get("vector_store_ids");
      if (fs === null || fs.size !== 1 || ids === undefined) {
        return { text: null, error: "tool_resources.file_search shape not recognized" };
      }
      vsIds = collapse(ids);
    }
  }
  const outEntries: string[] = [];
  for (const entry of splitTopLevel(t.slice(1, -1))) {
    const props = parseObjectProps(entry);
    if (props === null) return { text: null, error: "a tools entry is not a literal object" };
    const type = stripQuotes(props.get("type"));
    if (type === "file_search") {
      const vs = vsIds === null ? "" : lang === "py" ? `, "vector_store_ids": ${vsIds}` : `, vector_store_ids: ${vsIds}`;
      outEntries.push(lang === "py" ? `{"type": "file_search"${vs}}` : `{ type: "file_search"${vs} }`);
    } else if (type === "function") {
      const inner = props.get("function")?.trim();
      if (inner === undefined || !inner.startsWith("{") || !inner.endsWith("}")) {
        return { text: null, error: "a function tool body is not a literal object" };
      }
      // Responses function tools are flat, never nested under "function"
      const body = collapse(inner.slice(1, -1));
      outEntries.push(lang === "py" ? `{"type": "function", ${body}}` : `{ type: "function", ${body} }`);
    } else if (type === "code_interpreter") {
      return { text: null, error: CODE_INTERPRETER_REASON };
    } else {
      return { text: null, error: `unrecognized tool type ${type ?? "(computed)"}` };
    }
  }
  return { text: `[${outEntries.join(", ")}]`, error: null };
}

function findAssistantsCreate(lines: string[], lang: Lang): CreateInfo | null {
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) if (RE_ASSISTANTS_CREATE.test(lines[i])) hits.push(i);
  if (hits.length === 0) return null;
  const broken = (reason: string): CreateInfo => ({ span: null, varName: null, lifted: null, reason });
  if (hits.length > 1) return broken("multiple assistants.create calls");
  const line = hits[0];
  const m = RE_ASSISTANTS_CREATE.exec(lines[line])!;
  const prefixRe =
    lang === "py"
      ? /^\s*(?:(\w+)\s*=\s*)?$/
      : /^\s*(?:(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*)?(?:await\s+)?$/;
  const prefix = prefixRe.exec(lines[line].slice(0, m.index));
  const call = readCall(lines, line, m.index + m[0].length - 1);
  if (prefix === null || call === null) return broken("assistants.create statement shape not recognized");
  if (!/^\s*;?\s*$/.test(lines[call.endLine].slice(call.endCol + 1))) {
    return broken("assistants.create statement shape not recognized");
  }
  const span: Span = { start: line, end: call.endLine };
  const varName = prefix[1] ?? null;

  let config: Map<string, string> | null;
  if (lang === "py") {
    config = parseKwargs(call.args);
  } else {
    const args = splitTopLevel(call.args);
    config = args.length === 1 ? parseObjectProps(args[0]) : null;
  }
  const partial = (reason: string): CreateInfo => ({ span, varName, lifted: null, reason });
  if (config === null) return partial("config is not a literal kwargs/object shape");
  for (const k of config.keys()) {
    if (!["model", "instructions", "tools", "tool_resources"].includes(k)) {
      return partial(`the ${k} config key is not auto-translated`);
    }
  }
  const model = config.get("model");
  if (model === undefined) return partial("no literal model in the config");
  const instructions = config.get("instructions") ?? null;
  for (const v of [model, instructions]) {
    if (v !== null && v.includes("\n")) return partial("multi-line config values are not auto-translated");
  }
  if (config.has("tool_resources") && !config.has("tools")) {
    return partial("tool_resources without tools is not auto-translated");
  }
  let tools: string | null = null;
  if (config.has("tools")) {
    const translated = translateTools(config.get("tools")!, config.get("tool_resources"), lang);
    if (translated.error !== null) return partial(translated.error);
    tools = translated.text;
  }
  return { span, varName, lifted: { model, instructions, tools }, reason: null };
}

/**
 * Ops removing a fully-inlined assistants.create. When the enclosing function
 * reduces to `return <var>.id`, the whole dead helper goes; callers land on
 * the checklist.
 */
function removeCreateOps(
  lines: string[],
  fns: FnRange[],
  span: Span,
  varName: string | null,
  lang: Lang,
): { ops: Op[]; removedFn: string | null } {
  const fn = fns.find((f) => f.header <= span.start && f.end >= span.end);
  // boundary that treats `$` as part of the identifier, so a "$foo" var is
  // detected (a bare \b misses the "$")
  const usesVar =
    varName === null
      ? null
      : new RegExp(String.raw`(?<![A-Za-z0-9_$])${reEscape(varName)}(?![A-Za-z0-9_$])`);
  if (fn !== undefined && varName !== null && usesVar !== null) {
    const bodyFrom = lang === "py" ? fn.start : fn.start + 1;
    const bodyTo = lang === "py" ? fn.end : fn.end - 1;
    const returnRe = new RegExp(
      String.raw`^\s*return\s+(?:await\s+)?${reEscape(varName)}(?:\.id)?\s*;?\s*$`,
    );
    let onlyReturn = true;
    for (let i = bodyFrom; i <= bodyTo; i++) {
      if (i >= span.start && i <= span.end) continue;
      if (lines[i].trim() === "") continue;
      if (!returnRe.test(lines[i])) {
        onlyReturn = false;
        break;
      }
    }
    if (onlyReturn) {
      return {
        ops: [{ kind: "delete", start: fn.header, end: fn.end, collapseBlank: true }],
        removedFn: fn.name,
      };
    }
  }
  // bare-span delete: only safe if the created var is used nowhere else.
  // Otherwise deleting just the create statement orphans db.save(x.id),
  // console.log(x.id), etc. -> leave the call in place (no ops).
  if (usesVar !== null) {
    const scanFrom = fn !== undefined ? (lang === "py" ? fn.start : fn.start + 1) : 0;
    const scanTo = fn !== undefined ? (lang === "py" ? fn.end : fn.end - 1) : lines.length - 1;
    for (let i = scanFrom; i <= scanTo; i++) {
      if (i >= span.start && i <= span.end) continue;
      if (usesVar.test(lines[i])) return { ops: [], removedFn: null };
    }
  }
  return { ops: [{ kind: "delete", start: span.start, end: span.end, collapseBlank: true }], removedFn: null };
}

// ---------------------------------------------------------------------------
// always-checklist patterns (3e)

// same id floor and bounded env prefix as the scanner, so the two never drift
const ASST_LITERAL = new RegExp(`(?<![A-Za-z0-9_])asst_[A-Za-z0-9]{${ID_LITERAL_MIN},}(?![A-Za-z0-9_])`);
const ASSISTANT_ENV = /(?<![A-Za-z0-9])[A-Z0-9_]{0,64}ASSISTANT_ID/;

const ALWAYS_RULES: Array<{ id: string; re: RegExp; text: string; backfill?: boolean }> = [
  {
    id: "assistants-function-calling",
    re: /requires_action|submit_tool_outputs|submitToolOutputs/,
    text:
      "Function calling: requires_action/submit_tool_outputs is gone in the Responses API. Tool calls arrive as function_call items and results go back as function_call_output items in the next request; the control flow inverts (nothing is submitted to a run). See https://developers.openai.com/api/docs/guides/function-calling",
  },
  {
    id: "assistants-raw-rest",
    re: /["'`]\/v1\/(assistants|threads)\b|OpenAI-Beta['"]?\s*[:=]\s*['"]?assistants/,
    text:
      "Raw REST calls to /v1/assistants or /v1/threads (including the OpenAI-Beta: assistants header) stop working at shutdown; rewrite them against /v1/responses and /v1/conversations manually.",
  },
  {
    id: "assistants-streaming",
    re: /runs\.stream|AssistantStream|create_and_stream/,
    text:
      "Streaming: runs.stream/AssistantStream events have no 1:1 mapping in the Responses API. Rewrite handlers against the typed SSE events (response.output_text.delta and friends).",
  },
  {
    id: "assistants-run-steps",
    re: /\bruns\.steps\b|\brun_steps\b|listRunSteps/,
    text:
      "Run-steps analytics: the Responses API has no run-steps endpoint; the equivalent detail lives on response.output items. Rework the analytics against those.",
  },
  {
    id: "assistants-truncation-strategy",
    re: /truncation_strategy/,
    text:
      "truncation_strategy does not exist on responses.create; use the truncation parameter and re-verify the context-window behavior.",
  },
  {
    id: "assistants-attachments",
    re: /\battachments\s*[=:]/,
    text:
      "Per-message attachments have no direct Responses equivalent; move the files to a file_search vector store (tools[].vector_store_ids) or input_file content parts.",
  },
  {
    id: "assistants-thread-backfill",
    re: new RegExp(
      `(?<![A-Za-z0-9_])thread_[A-Za-z0-9]{${ID_LITERAL_MIN},}(?![A-Za-z0-9_])|(?<![A-Za-z0-9])[A-Z0-9_]{0,64}THREAD_ID|threads\\.retrieve`,
    ),
    text:
      "Stored threads need their history backfilled into Conversations before the 2026-08-26 shutdown. Run aidep/backfill-threads.mjs (generated in this PR) once per thread id; it lists anything it cannot carry over.",
    backfill: true,
  },
];

// ---------------------------------------------------------------------------
// per-file driver

function transformFile(file: EventFileInput): {
  ft: FileTransform;
  danceRewritten: boolean;
  /** a dance was rewritten but no in-code config was inlined: the emitted
   * responses.create has no model and fails until the config lands */
  bareDance: boolean;
} {
  const ft: FileTransform = { path: file.path, migrated: null, applied: [], checklist: [], swaps: [] };
  const lang = langOf(file.path);
  if (lang === null) return { ft, danceRewritten: false, bareDance: false };

  let lines = file.content.split("\n");
  const applied: AppliedChange[] = [];

  // (a) recognize the 4-call dance per function
  const fns = lang === "py" ? pyFunctions(lines) : jsFunctions(lines);
  const dances: Dance[] = [];
  const danceFns: FnRange[] = [];
  for (const fn of fns) {
    const rec = recognizeDance(lines, fn, lang);
    if (rec === null) continue;
    if (!rec.ok) {
      ft.checklist.push({
        id: "assistants-manual-run-loop",
        text: `manual: rewrite the run loop in ${mdEscape(file.path)} (pattern not fully recognized; ${rec.detail})`,
      });
      continue;
    }
    dances.push(rec.dance);
    danceFns.push(fn);
  }
  // run calls outside any recognized function body are never rewritten
  const fnSpans: Array<Span | null> = fns.map((f) => ({ start: f.header, end: f.end }));
  for (let i = 0; i < lines.length; i++) {
    if (inSpan(i, fnSpans)) continue;
    if (RE_MSG_CREATE.test(lines[i]) || RE_RUNS.test(lines[i]) || RE_MSG_LIST.test(lines[i])) {
      ft.checklist.push({
        id: "assistants-manual-run-loop",
        text: `manual: rewrite the run loop in ${mdEscape(file.path)} (pattern not fully recognized; run calls outside a recognized function body)`,
      });
      break;
    }
  }

  // (b) threads.create -> conversations.create, but only inside a function
  // whose dance we recognized. An unrecognized file stays byte-identical and
  // degrades purely to the checklist, never a broken hybrid that calls
  // conversations.create while still running the old messages/runs loop.
  const renameRe = /\b([\w.$]+)\.beta\.threads\.create\(/g;
  const danceSpans: Array<Span | null> = danceFns.map((f) => ({ start: f.header, end: f.end }));
  let renamed = false;
  for (let i = 0; i < lines.length; i++) {
    if (!inSpan(i, danceSpans)) continue;
    if (!/\.beta\.threads\.create\(/.test(lines[i])) continue;
    lines[i] = lines[i].replace(renameRe, "$1.conversations.create(");
    renamed = true;
  }
  if (renamed) {
    applied.push({
      kind: "rename-threads-create",
      description: `renamed beta.threads.create to conversations.create in ${file.path}`,
    });
  }

  // (c) in-code assistants.create: lift into the single recognized dance
  const create = findAssistantsCreate(lines, lang);
  let lifted: LiftedConfig | null = null;
  let createOps: Op[] = [];
  let removedFn: string | null = null;
  if (create !== null) {
    if (create.lifted !== null && create.span !== null && dances.length === 1) {
      // inline the config into the single responses.create either way
      lifted = create.lifted;
      const removal = removeCreateOps(lines, fns, create.span, create.varName, lang);
      createOps = removal.ops;
      removedFn = removal.removedFn;
      if (createOps.length === 0) {
        // the created var is used elsewhere, so the call cannot be removed
        // without orphaning those uses; keep it, just flag the duplication
        ft.checklist.push({
          id: "assistants-inline-partial",
          text: `assistants.create in ${mdEscape(file.path)} was left in place because its id is used elsewhere in the file; its config is now also inlined in the responses.create call, so remove the old assistants.create once its other uses are migrated.`,
        });
      }
    } else {
      const reason = create.reason ?? "no single recognized responses.create rewrite to inline into";
      ft.checklist.push({
        id: "assistants-inline-partial",
        text: `assistants.create in ${mdEscape(file.path)} was not auto-inlined (${mdEscape(reason)}); move its config into the new responses.create call manually.`,
      });
    }
  }

  const ops: Op[] = [];
  for (const d of dances) {
    ops.push(...danceOps(d, lang, lifted));
    applied.push({
      kind: "responses-rewrite",
      description: `rewrote the messages.create/runs/poll/messages.list dance in ${file.path} to a single responses.create`,
    });
  }
  if (createOps.length > 0) {
    ops.push(...createOps);
    applied.push({
      kind: "inline-assistant-config",
      description: `inlined the assistants.create config (model/instructions/tools) into responses.create in ${file.path}`,
    });
    if (removedFn !== null) {
      applied.push({
        kind: "remove-assistants-create",
        description: `removed the dead ${removedFn}() helper in ${file.path}`,
      });
      ft.checklist.push({
        id: "assistants-removed-create-helper",
        text: `${mdEscape(removedFn)}() in ${mdEscape(file.path)} was removed; its Assistant config is now inlined in the responses.create call, update any callers.`,
      });
    } else {
      applied.push({
        kind: "remove-assistants-create",
        description: `removed the dead assistants.create call in ${file.path}`,
      });
    }
  }

  if (ops.length > 0) lines = applyOps(lines, ops);
  if (applied.length > 0) {
    ft.applied.push(...applied);
    ft.migrated = lines.join("\n");
  }
  return {
    ft,
    danceRewritten: dances.length > 0,
    bareDance: dances.length > 0 && lifted === null,
  };
}

// ---------------------------------------------------------------------------

export function transformAssistants(
  event: RegistryRow,
  files: EventFileInput[],
): EventTransformResult {
  const eventChecklist: ChecklistItem[] = [];
  const generatedFiles: EventTransformResult["generatedFiles"] = [];

  let anyDance = false;
  let anyBareDance = false;
  const outFiles = files.map((f) => {
    const { ft, danceRewritten, bareDance } = transformFile(f);
    anyDance = anyDance || danceRewritten;
    anyBareDance = anyBareDance || bareDance;
    return ft;
  });

  // (d) config must be fetched and inlined when the assistant is defined in
  // the dashboard/env, or when a dance was rewritten without an in-code
  // create in the same file (the bare responses.create fails until then)
  const anyCreate = files.some((f) => /\.beta\.assistants\.create\(/.test(f.content));
  const envRef = files.some((f) => ASST_LITERAL.test(f.content) || ASSISTANT_ENV.test(f.content));
  if (anyBareDance || (!anyCreate && (envRef || anyDance))) {
    eventChecklist.push({
      id: "assistants-fetch-and-inline",
      text: `The Assistant's config (model/instructions/tools) is not in this code, so rewritten responses.create calls have no model yet and will fail until it is inlined. The Assistants API dies ${event.dies ?? "2026-08-26"} and the config must move into the code; aidep inlines configs and never points calls at hosted prompt objects (prompt creation is dashboard-only and /v1/prompts itself dies 2026-11-30). Run aidep/fetch-and-inline.mjs (generated in this PR) with OPENAI_API_KEY and the assistant id, then merge the printed model/instructions/tools into the new responses.create call(s).`,
    });
    generatedFiles.push({ path: "aidep/fetch-and-inline.mjs", content: FETCH_AND_INLINE_MJS });
  }

  // (e) always-checklist patterns
  for (const rule of ALWAYS_RULES) {
    if (!files.some((f) => rule.re.test(f.content))) continue;
    eventChecklist.push({ id: rule.id, text: rule.text });
    if (rule.backfill === true) {
      generatedFiles.push({ path: "aidep/backfill-threads.mjs", content: BACKFILL_THREADS_MJS });
    }
  }

  return { files: outFiles, eventChecklist, generatedFiles };
}
