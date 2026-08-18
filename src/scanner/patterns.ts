import type { RegistryRow } from "../registry.ts";

/**
 * A compiled pattern. "line" matchers fire on any line they match; "param"
 * matchers only fire in files that also pass PARAM_MODEL_GATE (scan.ts owns
 * that co-occurrence check). `display` is what lands in Finding.matched.
 */
export interface Matcher {
  row: RegistryRow;
  kind: "line" | "param";
  regex: RegExp;
  display: string;
}

/**
 * Param findings only count when the same file pins a Claude model new enough
 * for the params to be a live deprecation (claude 4.7+, claude 5+, or the
 * mythos family). Bare `temperature` in unrelated code never fires.
 */
export const PARAM_MODEL_GATE =
  /claude-(?:[a-z]+-)*(?:4-[7-9]|[5-9])(?![0-9])|claude-mythos/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The char before/after a registry id must not look like part of a longer id,
// so "gpt-4-turbo" never fires inside "gpt-4-turbo-preview".
export const ID_BOUNDARY_LEFT = "(?<![A-Za-z0-9._-])";
export const ID_BOUNDARY_RIGHT = "(?![A-Za-z0-9._-])";

const ASSISTANTS_ROW_ID = "openai:endpoint:assistants-api";

function assistantsMatchers(row: RegistryRow): Matcher[] {
  const defs: Array<[RegExp, string]> = [
    // Match on the distinctive `.beta.assistants` / `.beta.threads` tail and
    // accept ANY receiver. Real code names the client whatever it likes:
    // `openai_client` (the name in OpenAI's own examples), `oai`, `_client`,
    // `self.client`. Requiring the receiver to be literally `client` or
    // `openai` missed a live Assistants call in ComposioHQ/composio, found
    // 2026-08-18 by diffing against a human migration of that same file.
    [/\.beta\.assistants\b/, ".beta.assistants"],
    [/\.beta\.threads\b/, ".beta.threads"],
    [/\bcreate_and_poll\b/, "create_and_poll"],
    [/\bcreateAndPoll\b/, "createAndPoll"],
    [/\bsubmit_tool_outputs\b/, "submit_tool_outputs"],
    [/\bsubmitToolOutputs\b/, "submitToolOutputs"],
    [/\bcreate_and_run\b/, "create_and_run"],
    [/\bcreateAndRun\b/, "createAndRun"],
    [/\bruns\.stream\b/, "runs.stream"],
    // matches both `OpenAI-Beta: assistants=v2` and `"OpenAI-Beta": "assistants=v2"`
    [/OpenAI-Beta['"]?\s*[:=]\s*['"]?assistants/, "OpenAI-Beta: assistants header"],
    [/(?<![A-Za-z0-9_])asst_[A-Za-z0-9]{6,}/, "asst_ id literal"],
    [/(?<![A-Za-z0-9_])thread_[A-Za-z0-9]{6,}/, "thread_ id literal"],
    [/(?<![A-Za-z0-9_])run_[A-Za-z0-9]{6,}/, "run_ id literal"],
    [/(?<![A-Za-z0-9])[A-Z0-9_]*ASSISTANT_ID[A-Z0-9_]*/, "ASSISTANT_ID env var"],
  ];
  return defs.map(([regex, display]) => ({ row, kind: "line", regex, display }));
}

export function buildPatterns(rows: RegistryRow[]): Matcher[] {
  const matchers: Matcher[] = [];
  for (const row of rows) {
    if (row.surface === "param") {
      for (const id of row.api_ids) {
        matchers.push({
          row,
          kind: "param",
          regex: new RegExp(`\\b${escapeRegExp(id)}\\s*[:=]`),
          display: id,
        });
      }
      continue;
    }
    for (const id of row.api_ids) {
      // an id edge that is already outside the id charset (e.g. the leading
      // "/" of "/v1/assistants") is its own boundary; a lookaround there
      // would wrongly reject "api.openai.com/v1/assistants"
      const left = /^[A-Za-z0-9._-]/.test(id) ? ID_BOUNDARY_LEFT : "";
      const right = /[A-Za-z0-9._-]$/.test(id) ? ID_BOUNDARY_RIGHT : "";
      matchers.push({
        row,
        kind: "line",
        regex: new RegExp(left + escapeRegExp(id) + right),
        display: id,
      });
    }
    if (row.id === ASSISTANTS_ROW_ID) {
      matchers.push(...assistantsMatchers(row));
    }
  }
  return matchers;
}
