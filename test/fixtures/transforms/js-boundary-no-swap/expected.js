import OpenAI from "openai";

const openai = new OpenAI();

export async function draft(question) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [{ role: "user", content: question }],
  });
  return completion.choices[0].message.content ?? "";
}
