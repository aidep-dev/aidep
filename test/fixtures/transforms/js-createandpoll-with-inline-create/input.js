import OpenAI from "openai";

const openai = new OpenAI();

export async function createReviewAssistant() {
  const assistant = await openai.beta.assistants.create({
    model: "gpt-4-turbo",
    instructions: "Review pull requests and flag risky changes.",
    tools: [{ type: "file_search" }],
    tool_resources: {
      file_search: { vector_store_ids: ["vs_review_docs"] },
    },
  });
  return assistant.id;
}

export async function askAssistant(assistantId, threadId, question) {
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: question,
  });
  const run = await openai.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: assistantId,
  });
  const messages = await openai.beta.threads.messages.list(threadId);
  return messages.data[0].content[0].text.value;
}
