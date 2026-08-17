import os
import time

import requests
from openai import OpenAI

client = OpenAI()

ASSISTANT_ID = os.environ["OPENAI_ASSISTANT_ID"]


def ask_assistant(prompt: str) -> list[str]:
    thread = client.conversations.create()
    response = client.responses.create(
        conversation=thread.id,
        input=[{"role": "user", "content": prompt}],
    )
    return [response.output_text]


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
