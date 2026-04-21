import json
import openai


def generate(code: str, language: str) -> dict:
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert code reviewer specialising in blockchain and smart contracts. "
                    "Analyse the provided code and return ONLY valid JSON with keys: "
                    "issues (list of {severity: critical|high|medium|low, description: str, line: int|null}), "
                    "score (0-10), suggestions (list of strings). "
                    "Be precise and actionable."
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
            "issues": [],
            "score": 7,
            "suggestions": [rsp.choices[0].message.content],
        }
