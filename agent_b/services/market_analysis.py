import json
import openai


def generate(token: str, timeframe: str) -> dict:
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a crypto market analyst with deep knowledge of on-chain metrics, "
                    "tokenomics, DeFi trends, and macroeconomic signals. "
                    "Provide a market analysis based on your training data and reasoning. "
                    "Return ONLY valid JSON with keys: "
                    "trend (one of: bullish, bearish, neutral), "
                    "analysis (string, 3-4 sentence market overview covering price action, fundamentals, and catalysts), "
                    "confidence (float 0.0-1.0), "
                    "key_factors (list of strings, top 3-5 factors driving the trend), "
                    "risk_factors (list of strings, top 3 risks to watch)."
                ),
            },
            {
                "role": "user",
                "content": f"Token: {token.upper()}\nTimeframe: {timeframe}\n\nProvide a market analysis.",
            },
        ],
    )
    try:
        return json.loads(rsp.choices[0].message.content)
    except Exception:
        return {
            "trend": "neutral",
            "analysis": rsp.choices[0].message.content,
            "confidence": 0.6,
            "key_factors": [],
            "risk_factors": [],
        }
