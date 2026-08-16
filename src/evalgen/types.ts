/** One extracted eval case: a prompt template plus sample vars and the
 * deterministic checks inferred from the call site. */
export interface EvalCase {
  description: string;
  /** prompt template, promptfoo {{var}} syntax */
  prompt: string;
  /** one or more sample var sets */
  vars: Array<Record<string, string>>;
  checks: {
    /** output must parse as JSON */
    json?: boolean;
    /** output must be one of these values (enum membership) */
    oneOf?: string[];
    /** output must contain this substring */
    contains?: string;
  };
}

/** LLM seam for prompt extraction. Production: plain fetch to the Anthropic
 * Messages API with our key. Tests: canned responses. */
export type Llm = (system: string, user: string) => Promise<string>;

export interface EvalPackInput {
  oldModelId: string;
  newModelId: string;
  /** promptfoo provider id for the old/new models, e.g. "openai:gpt-4-turbo" */
  oldProvider: string;
  newProvider: string;
  /** judge pinned to a different family than the model under test */
  judgeProvider: string;
  cases: EvalCase[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}
