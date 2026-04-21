"""
Escrow tools: create, release, refund via Anchor escrow program.
Calls anchor_client.ts via subprocess so Python doesn't need Solana SDK.
"""
import json
import os
import subprocess
import time
import uuid
from langchain_core.tools import tool

SCRIPTS_DIR = os.path.join(os.path.dirname(__file__), "../../scripts")
CLIENT_SCRIPT = os.path.join(SCRIPTS_DIR, "anchor_client.ts")


def _run_ts(command: str, *args: str) -> dict:
    """Call a function exported from anchor_client.ts via a thin CLI wrapper."""
    try:
        result = subprocess.run(
            ["npx", "tsx", CLIENT_SCRIPT, command, *args],
            capture_output=True, text=True, timeout=60, cwd=SCRIPTS_DIR,
        )
        stderr = result.stderr.strip()
        if result.returncode != 0 or "IdlError" in stderr or "Error" in stderr:
            return {"error": stderr or "ts-node error", "fallback": True}
        try:
            return json.loads(result.stdout.strip())
        except (json.JSONDecodeError, ValueError):
            return {"error": f"invalid JSON from anchor_client: {result.stdout[:200]}", "fallback": True}
    except subprocess.TimeoutExpired:
        return {"error": "anchor_client.ts timed out (60s)", "fallback": True}
    except Exception as e:
        return {"error": str(e), "fallback": True}


@tool
def create_escrow(seller_pubkey: str, amount_usdc: float, job_id: str = "") -> str:
    """Lock USDC in an on-chain Solana escrow for a job.
    seller_pubkey: Solana base58 address of Agent B.
    amount_usdc: amount in USDC (e.g. 0.005).
    job_id: unique hex string (auto-generated if empty).
    Returns JSON: {escrow_pda, tx_hash, deadline, explorer_url}"""
    if not job_id:
        job_id = uuid.uuid4().hex
    amount_micro = int(amount_usdc * 1_000_000)
    arbitrator = os.environ.get("AGENT_C_SOL_PRIVATE_KEY_BS58", seller_pubkey)
    result = _run_ts("create_escrow", seller_pubkey, arbitrator, str(amount_micro), job_id)
    if "error" in result:
        # Keep agent execution moving in local/dev mode when Anchor programs are unavailable.
        return json.dumps({
            "escrow_pda": f"mock-escrow-{job_id}",
            "tx_hash": f"mock-create-{job_id[:12]}",
            "deadline": int(time.time()) + 120,
            "explorer_url": "",
            "warning": result["error"],
        })
    return json.dumps({
        **result,
        "explorer_url": f"https://explorer.solana.com/tx/{result.get('txHash', '')}?cluster=devnet",
    })


@tool
def release_escrow(job_id: str, seller_pubkey: str) -> str:
    """Release escrowed USDC to the seller after successful job completion.
    job_id: the hex job ID used when creating the escrow.
    Returns JSON: {tx_hash, amount_released, explorer_url}"""
    result = _run_ts("release_payment", job_id, seller_pubkey)
    if "error" in result:
        return json.dumps({
            "tx_hash": f"mock-release-{job_id[:12]}",
            "amount_released": 0,
            "explorer_url": "",
            "warning": result["error"],
        })
    return json.dumps({
        "tx_hash": result.get("txHash", ""),
        "amount_released": result.get("amount", 0),
        "explorer_url": f"https://explorer.solana.com/tx/{result.get('txHash', '')}?cluster=devnet",
    })


@tool
def refund_escrow(job_id: str) -> str:
    """Refund escrowed USDC back to buyer (call before deadline if job was not completed).
    job_id: the hex job ID used when creating the escrow.
    Returns JSON: {tx_hash, explorer_url}"""
    result = _run_ts("refund_escrow", job_id)
    if "error" in result:
        return json.dumps({
            "tx_hash": f"mock-refund-{job_id[:12]}",
            "explorer_url": "",
            "warning": result["error"],
        })
    return json.dumps({
        "tx_hash": result.get("txHash", ""),
        "explorer_url": f"https://explorer.solana.com/tx/{result.get('txHash', '')}?cluster=devnet",
    })
