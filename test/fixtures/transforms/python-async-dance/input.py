import os

from openai import AsyncOpenAI

client = AsyncOpenAI()

ASSISTANT_ID = os.environ["OPENAI_ASSISTANT_ID"]


async def ask_assistant(prompt: str) -> str:
    thread = await client.beta.threads.create()
    await client.beta.threads.messages.create(
        thread_id=thread.id, role="user", content=prompt
    )
    run = await client.beta.threads.runs.create_and_poll(
        thread_id=thread.id, assistant_id=ASSISTANT_ID
    )
    messages = await client.beta.threads.messages.list(thread_id=thread.id)
    return messages.data[0].content[0].text.value
