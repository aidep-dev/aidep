import anthropic

client = anthropic.Anthropic()


def summarize(text: str) -> str:
    message = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1024,
        messages=[{"role": "user", "content": "Summarize this:\n\n" + text}],
    )
    return message.content[0].text
