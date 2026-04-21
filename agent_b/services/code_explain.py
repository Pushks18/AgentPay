import json
import openai


def generate(code: str, language: str) -> dict:
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a coding tutor. Explain the provided code clearly and concisely. "
                    "Return ONLY valid JSON with keys: "
                    "explanation (string, 2-3 sentence overview), "
                    "concepts (list of key programming concepts used), "
                    "line_by_line (list of {lines: str, explanation: str} for logical blocks)."
                ),
            },
            {
                "role": "user",
                "content": f"Language: {language}\n\n```{language}\n{code}\n```",
            },
        ],
    )
    try:
        return json.loads(rsp.choices[0].message.content)
    except Exception:
        return {
            "explanation": rsp.choices[0].message.content,
            "concepts": [],
            "line_by_line": [],
        }
