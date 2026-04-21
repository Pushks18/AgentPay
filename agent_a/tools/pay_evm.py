import asyncio
import json
import os

from eth_account import Account
from langchain_core.tools import tool
from x402 import x402Client
from x402.http import x402HTTPClient
from x402.http.clients.httpx import x402HttpxClient
from x402.mechanisms.evm.exact.register import register_exact_evm_client

account = Account.from_key(os.environ["AGENT_A_EVM_PRIVATE_KEY"])
x_client = x402Client()
register_exact_evm_client(x_client, signer=account)
http_client = x402HTTPClient(x_client)


@tool
def pay_and_fetch_evm_agent(agent_endpoint: str, payload_json: str) -> str:
    """Pay USDC via x402 on Avalanche Fuji and call an AI agent endpoint.
    Use when the agent's chain is 'avalanche-fuji'.
    Returns JSON: {status, body, tx_hash, chain, amount_paid, explorer_url}"""

    async def _run():
        body = json.loads(payload_json) if payload_json else {}
        try:
            async with x402HttpxClient(http_client) as client:
                resp = await client.post(agent_endpoint, json=body)
                resp.raise_for_status()
                tx_raw = resp.headers.get("X-PAYMENT-RESPONSE", "")
                tx_hash = ""
                amount_paid = 0.0
                try:
                    pay_resp = json.loads(tx_raw) if tx_raw else {}
                    tx_hash = pay_resp.get("txHash", pay_resp.get("transaction", ""))
                    amount_paid = pay_resp.get("amount", 0)
                except Exception:
                    tx_hash = tx_raw
                return json.dumps({
                    "status": resp.status_code,
                    "body": resp.json(),
                    "tx_hash": tx_hash,
                    "chain": "avalanche-fuji",
                    "amount_paid": amount_paid,
                    "explorer_url": f"https://testnet.snowtrace.io/tx/{tx_hash}" if tx_hash else "",
                })
        except Exception as e:
            return json.dumps({"error": str(e), "retry_with_next": True})

    return asyncio.run(_run())
