import openai

client = openai.OpenAI()


def rank_items(items: list[str]) -> str:
    completion = client.chat.completions.create(
        model="gpt-5.6-sol",
        temperature=0.7,
        messages=[{"role": "user", "content": "Rank these:\n" + "\n".join(items)}],
    )
    return completion.choices[0].message.content
