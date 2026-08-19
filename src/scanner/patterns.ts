import type { RegistryRow } from "../registry.ts";

/**
 * A compiled pattern. "line" matchers fire on any line they match; "param"
 * matchers only fire in files that also pass PARAM_MODEL_GATE (scan.ts owns
 * that co-occurrence check). `display` is what lands in Finding.matched.
 */
export interface Matcher {
  row: RegistryRow;
  kind: "line" | "param" | "assistants-helper";
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

/**
 * Helper names like `createAndPoll` and `submit_tool_outputs` say nothing on
 * their own: `createAndPoll` is a stock Stainless codegen name and fires
 * across most generated SDKs, and `submit_tool_outputs` is a path segment in
 * other vendors' chat APIs. They only mean the OpenAI Assistants API when the
 * same file also shows an unambiguous marker of it.
 *
 * Found 2026-08-19: without this gate, three of nine candidate repos
 * (coze-js, mixedbread-ts, anymodel) were flagged as exposed while containing
 * no OpenAI Assistants code at all. Telling a maintainer their code breaks
 * when it does not is worse than missing them.
 */
export const ASSISTANTS_FILE_GATE =
  /\.beta\.(assistants|threads)\b|openai\.types\.beta|from openai\b|require\(['"]openai['"]\)|['"]openai['"]|\/v1\/(assistants|threads)\b|OpenAI-Beta/i;

/**
 * Real OpenAI object ids are a prefix plus ~24 random alphanumerics. The old
 * {6,} floor matched ordinary snake_case identifiers: `run_document_ai_processor`
 * and `thread_channel` produced 12 false findings in one real repo (43% of
 * that scan). Require an id-shaped run and refuse a trailing word char so a
 * longer snake_case name cannot satisfy it.
 */
const ID_LITERAL_MIN = 16;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The char before/after a registry id must not look like part of a longer id,
// so "gpt-4-turbo" never fires inside "gpt-4-turbo-preview".
export const ID_BOUNDARY_LEFT = "(?<![A-Za-z0-9._-])";
export const ID_BOUNDARY_RIGHT = "(?![A-Za-z0-9._-])";

const ASSISTANTS_ROW_ID = "openai:endpoint:assistants-api";

function assistantsMatchers(row: RegistryRow): Matcher[] {
  // unambiguous on their own: an OpenAI SDK call shape, a header, an env var
  const strong: Array<[RegExp, string]> = [
    // Match on the distinctive `.beta.assistants` / `.beta.threads` tail and
    // accept ANY receiver. Real code names the client whatever it likes:
    // `openai_client` (the name in OpenAI's own examples), `oai`, `_client`,
    // `self.client`. Requiring the receiver to be literally `client` or
    // `openai` missed a live Assistants call in ComposioHQ/composio, found
    // 2026-08-18 by diffing against a human migration of that same file.
    [/\.beta\.assistants\b/, ".beta.assistants"],
    [/\.beta\.threads\b/, ".beta.threads"],
    // Ruby SDKs express it as a keyword arg rather than a dot-chain:
    // `client.beta(assistants: OpenAI::Assistants::BETA_VERSION)`. Missed
    // every Assistants call in alexrudall/ruby-openai (45M downloads) until
    // 2026-08-19.
    [/\.beta\(\s*assistants\s*:/, "beta(assistants:)"],
    [/openai\.types\.beta\.threads/i, "openai.types.beta.threads"],
    // matches both `OpenAI-Beta: assistants=v2` and `"OpenAI-Beta": "assistants=v2"`
    [/OpenAI-Beta['"]?\s*[:=]\s*['"]?assistants/, "OpenAI-Beta: assistants header"],
    [
      new RegExp(`(?<![A-Za-z0-9_])asst_[A-Za-z0-9]{${ID_LITERAL_MIN},}(?![A-Za-z0-9_])`),
      "asst_ id literal",
    ],
    [
      new RegExp(`(?<![A-Za-z0-9_])thread_[A-Za-z0-9]{${ID_LITERAL_MIN},}(?![A-Za-z0-9_])`),
      "thread_ id literal",
    ],
    [
      new RegExp(`(?<![A-Za-z0-9_])run_[A-Za-z0-9]{${ID_LITERAL_MIN},}(?![A-Za-z0-9_])`),
      "run_ id literal",
    ],
    [/(?<![A-Za-z0-9])[A-Z0-9_]*ASSISTANT_ID[A-Z0-9_]*/, "ASSISTANT_ID env var"],
  ];

  // Meaningless without OpenAI context in the same file; see ASSISTANTS_FILE_GATE.
  const helpers: Array<[RegExp, string]> = [
    [/\bcreate_and_poll\b/, "create_and_poll"],
    [/\bcreateAndPoll\b/, "createAndPoll"],
    [/\bsubmit_tool_outputs\b/, "submit_tool_outputs"],
    [/\bsubmitToolOutputs\b/, "submitToolOutputs"],
    [/\bcreate_and_run\b/, "create_and_run"],
    [/\bcreateAndRun\b/, "createAndRun"],
    [/\bruns\.stream\b/, "runs.stream"],
  ];

  return [
    ...strong.map(([regex, display]) => ({ row, kind: "line" as const, regex, display })),
    ...helpers.map(([regex, display]) => ({
      row,
      kind: "assistants-helper" as const,
      regex,
      display,
    })),
  ];
}

/**
 * An id distinctive enough to match unquoted. Short or dictionary-word ids
 * (`o1`, `ada`, `babbage`, `davinci`) match ordinary prose and identifiers, so
 * they only count inside a string literal. `davinci`, `babbage` and `o1` all
 * produced false findings on a real repo before this.
 */
function isDistinctiveId(id: string): boolean {
  if (/[/.]/.test(id)) return true; // path- or dotted-shaped, e.g. /v1/assistants
  return id.length >= 6 && /\d/.test(id) && /-/.test(id);
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
      // a non-distinctive id only counts inside quotes, where it is being used
      // as a model string rather than appearing as an English word
      const body = isDistinctiveId(id)
        ? left + escapeRegExp(id) + right
        : `['"\`]${escapeRegExp(id)}['"\`]`;
      matchers.push({
        row,
        kind: "line",
        regex: new RegExp(body),
        display: id,
      });
    }
    if (row.id === ASSISTANTS_ROW_ID) {
      matchers.push(...assistantsMatchers(row));
    }
  }
  return matchers;
}
