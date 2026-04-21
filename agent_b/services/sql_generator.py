import json
import openai


def generate(description: str, dialect: str) -> dict:
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are a {dialect} SQL expert. "
                    "Generate production-quality SQL for the user's description. "
                    "Return ONLY valid JSON with keys: sql (string), explanation (string). "
                    "The SQL should be well-formatted with proper indentation."
                ),
            },
            {"role": "user", "content": description},
        ],
    )
    try:
        return json.loads(rsp.choices[0].message.content)
    except Exception:
        return {
            "sql": rsp.choices[0].message.content,
            "explanation": "Generated SQL — verify before running in production.",
        }
