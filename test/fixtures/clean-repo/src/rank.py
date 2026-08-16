import openai

client = openai.OpenAI()


def rank_leads(leads: list[str]) -> str:
    completion = client.chat.completions.create(
        model="gpt-5.6-sol",
        temperature=0.3,
        messages=[{"role": "user", "content": "Score these leads:\n" + "\n".join(leads)}],
    )
    return completion.choices[0].message.content
