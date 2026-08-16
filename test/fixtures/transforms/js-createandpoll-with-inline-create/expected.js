import OpenAI from "openai";

const openai = new OpenAI();

export async function askAssistant(assistantId, threadId, question) {
  const response = await openai.responses.create({
    model: "gpt-4-turbo",
    instructions: "Review pull requests and flag risky changes.",
    tools: [{ type: "file_search", vector_store_ids: ["vs_review_docs"] }],
    conversation: threadId,
    input: [{ role: "user", content: question }],
  });
  return response.output_text;
}
