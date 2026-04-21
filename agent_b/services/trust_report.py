import openai


def generate(wallet: str) -> dict:
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a blockchain trust-scoring system. "
                    "Produce a JSON-formatted trust analysis for a wallet address. "
                    "Include: score (0.0-1.0), summary (2 sentences), "
                    "flags (list of risk factors, empty list if none). "
                    "Respond ONLY with valid JSON."
                ),
            },
            {"role": "user", "content": f"Wallet: {wallet}"},
        ],
    )
    import json
    try:
        return json.loads(rsp.choices[0].message.content)
    except Exception:
        return {
            "score": 0.5,
            "summary": rsp.choices[0].message.content,
            "flags": [],
        }
