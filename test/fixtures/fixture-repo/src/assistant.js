import OpenAI from "openai";

const openai = new OpenAI();

export async function createReviewAssistant() {
  const assistant = await openai.beta.assistants.create({
    model: "gpt-4-turbo",
    instructions: "Review pull requests and flag risky changes.",
    tools: [{ type: "code_interpreter" }],
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
  return run;
}
