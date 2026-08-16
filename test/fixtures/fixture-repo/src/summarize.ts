import OpenAI from "openai";

const openai = new OpenAI();

export async function summarize(text: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5-2025-08-07",
    messages: [{ role: "user", content: `Summarize this ticket: ${text}` }],
  });
  return completion.choices[0].message.content ?? "";
}
