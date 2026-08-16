from google import genai

client = genai.Client()


def label_ticket(subject: str, body: str) -> str:
    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents="Pick one label for this ticket.\n\n" + subject + "\n" + body,
    )
    return response.text.strip()
