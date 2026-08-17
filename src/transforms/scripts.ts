/**
 * Static generated-file templates. These are string constants only; no repo
 * content is ever interpolated into them; and they must never mention prompt
 * objects by id (aidep inlines configs; /v1/prompts dies 2026-11-30 and prompt
 * creation is dashboard-only).
 */

export const FETCH_AND_INLINE_MJS = `#!/usr/bin/env node
// aidep fetch-and-inline: turn a dashboard-defined OpenAI Assistant into an
// inlined responses.create config. The Assistants API shuts down 2026-08-26.
// aidep inlines configs instead of pointing at hosted prompt objects: prompt
// creation is dashboard-only and /v1/prompts itself dies 2026-11-30.
//
// Usage: OPENAI_API_KEY=sk-... node aidep/fetch-and-inline.mjs asst_abc123
//
// Plain node (18+), no dependencies.

const key = process.env.OPENAI_API_KEY;
const id = process.argv[2];
if (!key || !id) {
  console.error("usage: OPENAI_API_KEY=... node aidep/fetch-and-inline.mjs <assistant_id>");
  process.exit(1);
}

const res = await fetch("https://api.openai.com/v1/assistants/" + id, {
  headers: {
    Authorization: "Bearer " + key,
    "OpenAI-Beta": "assistants=v2",
  },
});
if (!res.ok) {
  console.error("GET /v1/assistants/" + id + " failed: " + res.status + " " + (await res.text()));
  process.exit(1);
}
const assistant = await res.json();

const tools = [];
for (const t of assistant.tools ?? []) {
  if (t.type === "file_search") {
    const ids = assistant.tool_resources?.file_search?.vector_store_ids ?? [];
    tools.push({ type: "file_search", vector_store_ids: ids });
  } else if (t.type === "function") {
    // Responses function tools are flat: { type: "function", name, ... } -
    // NOT nested under a "function" key like the Assistants shape.
    tools.push({ type: "function", ...t.function });
  } else if (t.type === "code_interpreter") {
    console.error(
      "skipping code_interpreter: the Responses code_interpreter uses a container model" +
        " with a 20-minute idle expiry; migrate it manually",
    );
  } else {
    console.error("skipping unknown tool type: " + t.type);
  }
}

const model = JSON.stringify(assistant.model);
const instructions = JSON.stringify(assistant.instructions ?? "");
const toolsJson = JSON.stringify(tools);
// carry the assistant's own sampling/format config over: dropping these would
// silently change behaviour. temperature/top_p/metadata keep their name on
// responses.create; response_format becomes text.format.
const hasTemp = assistant.temperature !== undefined && assistant.temperature !== null;
const hasTopP = assistant.top_p !== undefined && assistant.top_p !== null;
const rf = assistant.response_format;
const hasRf = rf !== undefined && rf !== null && rf !== "auto";
const meta =
  assistant.metadata && Object.keys(assistant.metadata).length > 0
    ? JSON.stringify(assistant.metadata)
    : null;

console.log("# Python");
console.log("response = client.responses.create(");
console.log("    model=" + model + ",");
console.log("    instructions=" + instructions + ",");
if (tools.length > 0) {
  console.log("    tools=" + toolsJson + ",  # rewrite true/false/null as True/False/None");
}
if (hasTemp) console.log("    temperature=" + assistant.temperature + ",");
if (hasTopP) console.log("    top_p=" + assistant.top_p + ",");
if (hasRf) {
  console.log('    text={"format": ' + JSON.stringify(rf) + "},  # response_format -> text.format");
}
if (meta) console.log("    metadata=" + meta + ",");
console.log("    conversation=conversation_id,");
console.log('    input=[{"role": "user", "content": user_input}],');
console.log(")");
console.log("");
console.log("// JavaScript");
console.log("const response = await openai.responses.create({");
console.log("  model: " + model + ",");
console.log("  instructions: " + instructions + ",");
if (tools.length > 0) {
  console.log("  tools: " + toolsJson + ",");
}
if (hasTemp) console.log("  temperature: " + assistant.temperature + ",");
if (hasTopP) console.log("  top_p: " + assistant.top_p + ",");
if (hasRf) {
  console.log("  text: { format: " + JSON.stringify(rf) + " },  // response_format -> text.format");
}
if (meta) console.log("  metadata: " + meta + ",");
console.log("  conversation: conversationId,");
console.log('  input: [{ role: "user", content: userInput }],');
console.log("});");
`;

export const BACKFILL_THREADS_MJS = `#!/usr/bin/env node
// aidep backfill-threads: copy an Assistants-API thread's message history into
// a Conversations-API conversation before the 2026-08-26 shutdown. Implements
// OpenAI's paging recipe (messages.list with order=asc, iterated page by page)
// via raw fetch.
//
// *** LOUD WARNING ***********************************************************
// OpenAI's official migration recipe silently DROPS image_file content parts
// and per-message attachments. This script does not drop them silently: it
// warns and skips them explicitly, listing every skipped item on stderr so
// you can migrate those by hand.
// ****************************************************************************
//
// Usage: OPENAI_API_KEY=sk-... node aidep/backfill-threads.mjs thread_abc123
//
// Prints the new conversation id on stdout. Plain node (18+), no dependencies.

const key = process.env.OPENAI_API_KEY;
const threadId = process.argv[2];
if (!key || !threadId) {
  console.error("usage: OPENAI_API_KEY=... node aidep/backfill-threads.mjs <thread_id>");
  process.exit(1);
}

const readHeaders = {
  Authorization: "Bearer " + key,
  "OpenAI-Beta": "assistants=v2",
};
const writeHeaders = {
  Authorization: "Bearer " + key,
  "Content-Type": "application/json",
};

const items = [];
const skipped = [];
let after = null;
for (;;) {
  const url = new URL("https://api.openai.com/v1/threads/" + threadId + "/messages");
  url.searchParams.set("order", "asc");
  url.searchParams.set("limit", "100");
  if (after) url.searchParams.set("after", after);
  const res = await fetch(url, { headers: readHeaders });
  if (!res.ok) {
    console.error("GET " + url.pathname + " failed: " + res.status + " " + (await res.text()));
    process.exit(1);
  }
  const page = await res.json();
  for (const m of page.data ?? []) {
    const content = [];
    for (const part of m.content ?? []) {
      if (part.type === "text") {
        content.push({
          type: m.role === "assistant" ? "output_text" : "input_text",
          text: part.text.value,
        });
      } else if (part.type === "image_url") {
        if (m.role === "assistant") {
          // input_image is an input-only content type; the items API rejects
          // it on an assistant turn, so skip it loudly rather than send a 400
          skipped.push(m.id + ": assistant-role image_url (input_image is input-only)");
        } else {
          content.push({ type: "input_image", image_url: part.image_url.url });
        }
      } else if (part.type === "image_file") {
        // OpenAI's recipe drops these silently; we skip loudly instead.
        skipped.push(m.id + ": image_file " + part.image_file.file_id);
      } else {
        skipped.push(m.id + ": unsupported content type " + part.type);
      }
    }
    for (const att of m.attachments ?? []) {
      // OpenAI's recipe drops attachments silently; we skip loudly instead.
      skipped.push(m.id + ": attachment " + att.file_id);
    }
    if (content.length > 0) items.push({ type: "message", role: m.role, content });
  }
  if (!page.has_more) break;
  after = page.last_id;
}

const CHUNK = 20;
const createRes = await fetch("https://api.openai.com/v1/conversations", {
  method: "POST",
  headers: writeHeaders,
  body: JSON.stringify({ items: items.slice(0, CHUNK) }),
});
if (!createRes.ok) {
  console.error("POST /v1/conversations failed: " + createRes.status + " " + (await createRes.text()));
  process.exit(1);
}
const conversation = await createRes.json();
for (let i = CHUNK; i < items.length; i += CHUNK) {
  const addRes = await fetch("https://api.openai.com/v1/conversations/" + conversation.id + "/items", {
    method: "POST",
    headers: writeHeaders,
    body: JSON.stringify({ items: items.slice(i, i + CHUNK) }),
  });
  if (!addRes.ok) {
    console.error("POST conversation items failed: " + addRes.status + " " + (await addRes.text()));
    process.exit(1);
  }
}

if (skipped.length > 0) {
  console.error(
    "skipped " + skipped.length + " item(s) OpenAI's official recipe would have dropped silently:",
  );
  for (const s of skipped) console.error("  - " + s);
}
console.log(conversation.id);
`;
