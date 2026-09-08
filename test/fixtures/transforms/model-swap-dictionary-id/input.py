import openai

client = openai.OpenAI()


def embed(text: str) -> list[float]:
    ada = client.embeddings.create(model="ada", input=text)
    return ada.data[0].embedding
