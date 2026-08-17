import os
import time

from openai import OpenAI

client = OpenAI()

ASSISTANT_ID = os.environ["OPENAI_ASSISTANT_ID"]


def build_handler():
    def ask(prompt: str) -> list[str]:
        thread = client.conversations.create()
        response = client.responses.create(
            conversation=thread.id,
            input=[{"role": "user", "content": prompt}],
        )
        return [response.output_text]

    return ask


def other_helper(x: int) -> int:
    return x + 1
