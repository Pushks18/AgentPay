import json
import openai


def generate(text: str) -> dict:
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a sentiment analysis engine. Analyse the sentiment of the given text. "
                    "Return ONLY valid JSON with keys: "
                    "sentiment (one of: positive, negative, neutral), "
                    "score (float 0.0-1.0, where 1.0 = most positive/negative depending on sentiment), "
                    "reasoning (string, 1 sentence explaining the classification)."
                ),
            },
            {"role": "user", "content": f"Text: {text}"},
        ],
    )
    try:
        return json.loads(rsp.choices[0].message.content)
    except Exception:
        return {
            "sentiment": "neutral",
            "score": 0.5,
            "reasoning": rsp.choices[0].message.content,
        }
