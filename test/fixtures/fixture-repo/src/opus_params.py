import anthropic

client = anthropic.Anthropic()


def draft_reply(prompt: str) -> str:
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=2048,
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text
