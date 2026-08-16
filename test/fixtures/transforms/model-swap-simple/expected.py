import anthropic

client = anthropic.Anthropic()


def summarize(text: str) -> str:
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": "Summarize this:\n\n" + text}],
    )
    return message.content[0].text
