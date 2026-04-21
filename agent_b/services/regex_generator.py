import json
import openai


def generate(description: str) -> dict:
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a regex expert. Generate a regular expression matching the user's description. "
                    "Return ONLY valid JSON with keys: "
                    "regex (string, the pattern itself without delimiters), "
                    "explanation (string, how the regex works), "
                    "test_cases (list of {input: str, should_match: bool, reason: str})."
                ),
            },
            {"role": "user", "content": f"Generate a regex to: {description}"},
        ],
    )
    try:
        return json.loads(rsp.choices[0].message.content)
    except Exception:
        return {
            "regex": "",
            "explanation": rsp.choices[0].message.content,
            "test_cases": [],
        }
