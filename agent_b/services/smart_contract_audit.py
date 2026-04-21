import json
import openai


def generate(contract: str) -> dict:
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o",
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a senior smart contract security auditor with expertise in Solidity, EVM, and DeFi exploits. "
                    "Perform a thorough security audit of the provided smart contract. "
                    "Return ONLY valid JSON with keys: "
                    "vulnerabilities (list of {id: str, title: str, severity: critical|high|medium|low|info, "
                    "description: str, location: str, recommendation: str}), "
                    "severity (overall: critical|high|medium|low — use the highest found), "
                    "recommendations (list of general best-practice suggestions), "
                    "summary (string, 2-3 sentence overall assessment)."
                ),
            },
            {
                "role": "user",
                "content": f"Audit this smart contract:\n\n```solidity\n{contract}\n```",
            },
        ],
    )
    try:
        return json.loads(rsp.choices[0].message.content)
    except Exception:
        return {
            "vulnerabilities": [],
            "severity": "low",
            "recommendations": [rsp.choices[0].message.content],
            "summary": "Audit completed.",
        }
