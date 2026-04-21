import asyncio
import base64
import json
import os

from langchain_core.tools import tool
from solders.keypair import Keypair
from x402 import x402Client
from x402.http import x402HTTPClient
from x402.http.clients.httpx import x402HttpxClient
from x402.mechanisms.svm.exact.register import register_exact_svm_client
from x402.mechanisms.svm.signers import KeypairSigner

_key_bs58 = os.environ.get("AGENT_A_SOL_PRIVATE_KEY_BS58", "")
_key_hex = os.environ.get("AGENT_A_SOLANA_PRIVATE_KEY_HEX", "")

if _key_bs58:
    import base58
    sol_kp = KeypairSigner(Keypair.from_bytes(base58.b58decode(_key_bs58)))
elif _key_hex:
    sol_kp = KeypairSigner(Keypair.from_bytes(bytes.fromhex(_key_hex)))
else:
    sol_kp = None  # will fail at call time with a clear error

x_client = x402Client()
if sol_kp is not None:
    register_exact_svm_client(x_client, signer=sol_kp)
http_client = x402HTTPClient(x_client)


@tool
def pay_and_fetch_solana_agent(agent_endpoint: str, payload_json: str) -> str:
    """Pay USDC via x402 on Solana devnet and call an AI agent endpoint.
    Use when the agent's chain is 'solana-devnet'.
    Always create ATA with idempotent instruction before first transfer.
    Returns JSON: {status, body, tx_hash, chain, amount_paid, explorer_url}"""

    if sol_kp is None:
        return json.dumps({"error": "AGENT_A_SOL_PRIVATE_KEY_BS58 not set", "retry_with_next": True})

    async def _run():
        body = json.loads(payload_json) if payload_json else {}
        try:
            async with x402HttpxClient(http_client) as c:
                resp = await c.post(agent_endpoint, json=body)
                # x402 v2 uses PAYMENT-RESPONSE; v1 legacy uses X-PAYMENT-RESPONSE
                tx_raw = (
                    resp.headers.get("payment-response")
                    or resp.headers.get("PAYMENT-RESPONSE")
                    or resp.headers.get("X-PAYMENT-RESPONSE", "")
                )
                tx_hash = ""
                amount_paid = 0.0
                try:
                    if tx_raw:
                        # PAYMENT-RESPONSE is base64-encoded JSON in x402 v2
                        try:
                            padded = tx_raw + "=" * (4 - len(tx_raw) % 4)
                            pay_resp = json.loads(base64.b64decode(padded))
                        except Exception:
                            pay_resp = json.loads(tx_raw)
                        tx_hash = pay_resp.get("transaction", pay_resp.get("txHash", pay_resp.get("signature", "")))
                        amount_paid = pay_resp.get("amount", pay_resp.get("amountPaid", 0.005))
                except Exception:
                    tx_hash = tx_raw
                return json.dumps({
                    "status": resp.status_code,
                    "body": resp.json(),
                    "tx_hash": tx_hash,
                    "chain": "solana-devnet",
                    "amount_paid": amount_paid,
                    "explorer_url": f"https://explorer.solana.com/tx/{tx_hash}?cluster=devnet" if tx_hash else "",
                })
        except Exception as e:
            return json.dumps({"error": str(e), "retry_with_next": True})

    return asyncio.run(_run())
