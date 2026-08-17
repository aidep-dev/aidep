import anthropic

client = anthropic.Anthropic()


def opus_reply(prompt: str) -> str:
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


def haiku_reply(prompt: str) -> str:
    message = client.messages.create(
        model="claude-3-haiku-20240307",
        max_tokens=512,
        temperature=0.7,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text
