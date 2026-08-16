import os
import time

from openai import OpenAI

client = OpenAI()

ASSISTANT_ID = os.environ["OPENAI_ASSISTANT_ID"]


def kick_off(prompt: str) -> str:
    thread = client.conversations.create()
    client.beta.threads.messages.create(
        thread_id=thread.id, role="user", content=prompt
    )
    run = client.beta.threads.runs.create(
        thread_id=thread.id, assistant_id=ASSISTANT_ID
    )
    while run.status in ("queued", "in_progress"):
        time.sleep(1)
        run = client.beta.threads.runs.retrieve(thread_id=thread.id, run_id=run.id)
    return run.status
