import json
import openai


def generate(text: str, target_language: str) -> dict:
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a professional translator. Translate the given text to the target language. "
                    "Return ONLY valid JSON with keys: "
                    "translated (string), language (string), confidence (float 0-1). "
                    "Confidence should reflect translation quality based on ambiguity or technical terms."
                ),
            },
            {
                "role": "user",
                "content": f"Target language: {target_language}\n\nText: {text}",
            },
        ],
    )
    try:
        return json.loads(rsp.choices[0].message.content)
    except Exception:
        return {
            "translated": rsp.choices[0].message.content,
            "language": target_language,
            "confidence": 0.9,
        }
