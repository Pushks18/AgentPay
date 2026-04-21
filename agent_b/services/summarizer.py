import openai


def generate(text: str, fmt: str) -> dict:
    format_instructions = {
        "bullets": "Return a bullet-point list (use • as bullet character). 3-7 bullets.",
        "paragraph": "Return a single dense paragraph. Max 100 words.",
        "tldr": "Return a TLDR in exactly one sentence under 20 words.",
    }.get(fmt, "Return a clear summary.")

    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": f"You are a precise text summariser. {format_instructions}",
            },
            {"role": "user", "content": text[:4000]},  # safety truncation
        ],
    )
    return {"summary": rsp.choices[0].message.content}
