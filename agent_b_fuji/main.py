import os
import openai
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi_x402 import init_x402, pay
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AgentPay — Trust Reporter (Avalanche Fuji)")

init_x402(
    app,
    pay_to=os.environ["AGENT_B_EVM_ADDRESS"],
    network="avalanche-fuji",
    facilitator_url=os.environ.get("X402_FACILITATOR", "https://x402.org/facilitator"),
)


class TrustRequest(BaseModel):
    wallet: str


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/manifest")
def manifest():
    return {
        "name": "trust-reporter-fuji",
        "service": "trust_report",
        "chain": "avalanche-fuji",
        "endpoint": "/generate-trust-report",
        "price_usdc": 0.01,
        "agent_id": 1,
    }


@app.post("/generate-trust-report")
@pay("$0.01")
async def trust_report(req: TrustRequest):
    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        messages=[
            {"role": "system", "content": "Produce a 3-sentence trust score 0-1 for a wallet address. Be concise."},
            {"role": "user", "content": f"Wallet: {req.wallet}"},
        ],
    )
    return {"wallet": req.wallet, "report": rsp.choices[0].message.content}
