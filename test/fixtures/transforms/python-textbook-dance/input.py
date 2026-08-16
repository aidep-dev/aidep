import os
import time

import requests
from openai import OpenAI

client = OpenAI()

ASSISTANT_ID = os.environ["OPENAI_ASSISTANT_ID"]


def ask_assistant(prompt: str) -> list[str]:
    thread = client.beta.threads.create()
    client.beta.threads.messages.create(
        thread_id=thread.id, role="user", content=prompt
    )
    run = client.beta.threads.runs.create(
        thread_id=thread.id, assistant_id=ASSISTANT_ID
    )
    while run.status in ("queued", "in_progress"):
        time.sleep(1)
        run = client.beta.threads.runs.retrieve(thread_id=thread.id, run_id=run.id)
    messages = client.beta.threads.messages.list(thread_id=thread.id)
    return [m.content[0].text.value for m in messages.data]


def list_assistants_raw() -> dict:
    resp = requests.get(
        "https://api.openai.com/v1/assistants",
        headers={
            "Authorization": "Bearer " + os.environ["OPENAI_API_KEY"],
            "OpenAI-Beta": "assistants=v2",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()
