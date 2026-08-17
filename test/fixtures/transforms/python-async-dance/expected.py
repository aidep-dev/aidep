import os

from openai import AsyncOpenAI

client = AsyncOpenAI()

ASSISTANT_ID = os.environ["OPENAI_ASSISTANT_ID"]


async def ask_assistant(prompt: str) -> str:
    thread = await client.conversations.create()
    response = await client.responses.create(
        conversation=thread.id,
        input=[{"role": "user", "content": prompt}],
    )
    return response.output_text
