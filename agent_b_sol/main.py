import os
import subprocess
import openai
from fastapi import FastAPI
from x402.fastapi.middleware import require_payment
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AgentPay — Trust Reporter (Solana Devnet)")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/manifest")
def manifest():
    return {
        "name": "trust-reporter-sol",
        "service": "trust_report",
        "chain": "solana-devnet",
        "endpoint": "/generate-trust-report",
        "price_usdc": 0.005,
        "agent_id": "sol-b",
    }


app.middleware("http")(require_payment(
    path="/generate-trust-report",
    price="$0.005",
    pay_to_address=os.environ["AGENT_B_SOLANA_ADDRESS"],
    network="solana-devnet",
    facilitator_url=os.environ.get("PAYAI_FACILITATOR", "https://facilitator.payai.network"),
))


@app.post("/generate-trust-report")
async def trust_report(body: dict):
    wallet = body.get("wallet", "unknown")
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {"role": "system", "content": "Produce a 3-sentence trust score 0-1 for a wallet address. Be concise."},
            {"role": "user", "content": f"Trust score for {wallet}"},
        ],
    )
    # Fire-and-forget ZK reputation mint
    agent_addr = os.environ.get("AGENT_B_SOLANA_ADDRESS", "")
    if agent_addr:
        subprocess.Popen(
            ["node", "zk_reputation/zk_reputation.mjs", agent_addr, "1"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return {"wallet": wallet, "report": rsp.choices[0].message.content}
