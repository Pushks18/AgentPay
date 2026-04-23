"""
Reputation tools:
  write_reputation_evm  — ERC-8004 giveFeedback on Avalanche Fuji
  write_reputation_solana — Light Protocol ZK-compressed token mint
"""
import json
import os
import subprocess

from eth_account import Account
from langchain_core.tools import tool
from web3 import Web3

# ---------------------------------------------------------------------------
# EVM setup
# ---------------------------------------------------------------------------

FUJI_RPC = os.environ.get("FUJI_RPC", "https://api.avax-test.network/ext/bc/C/rpc")

REP_ABI = [
    {
        "type": "function",
        "name": "giveFeedback",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "agentId", "type": "uint256"},
            {"name": "value", "type": "int128"},
            {"name": "valueDecimals", "type": "uint8"},
            {"name": "tag1", "type": "bytes32"},
            {"name": "tag2", "type": "bytes32"},
            {"name": "feedbackURI", "type": "string"},
            {"name": "feedbackHash", "type": "bytes32"},
        ],
        "outputs": [{"name": "feedbackIndex", "type": "uint256"}],
    }
]

ZK_SCRIPT = os.path.join(os.path.dirname(__file__), "../../agent_b/zk_reputation.mjs")

# Solana registry IDs -> on-chain recipient addresses for reputation minting.
AGENT_ADDRESSES = {
    "sol-trust": "8XFrS35Ch1tqzmAXZ4n4YBjAwSFgUZbwbqpKFWzyevYe",
    "sol-code": "8XFrS35Ch1tqzmAXZ4n4YBjAwSFgUZbwbqpKFWzyevYe",
    "sol-summarize": "8XFrS35Ch1tqzmAXZ4n4YBjAwSFgUZbwbqpKFWzyevYe",
}


@tool
def write_reputation_evm(agent_id: int, rating: float, tags: list = None) -> str:
    """Write a reputation score on ERC-8004 ReputationRegistry on Avalanche Fuji.
    CRITICAL: uses AGENT_A_EVM_PRIVATE_KEY (buyer wallet) — never AGENT_B.
    agent_id: integer EVM agent ID from the ERC-8004 registry.
    rating: float 0.0–1.0 (converted to int128 * 100 internally).
    tags: optional list of tag strings.
    Returns JSON: {tx_hash, explorer_url, feedback_index}"""
    try:
        w3 = Web3(Web3.HTTPProvider(FUJI_RPC))
        rep_contract = w3.eth.contract(
            address=os.environ["ERC8004_REPUTATION"], abi=REP_ABI
        )
        acct = Account.from_key(os.environ["AGENT_A_EVM_PRIVATE_KEY"])
        value = int(rating * 100)

        tag_list = tags or []
        tag1 = (tag_list[0].encode().ljust(32, b"\x00"))[:32] if len(tag_list) > 0 else b"\x00" * 32
        tag2 = (tag_list[1].encode().ljust(32, b"\x00"))[:32] if len(tag_list) > 1 else b"\x00" * 32

        tx = rep_contract.functions.giveFeedback(
            int(agent_id), value, 2, tag1, tag2, "", b"\x00" * 32,
        ).build_transaction({
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address),
            "gas": 300_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction).hex()
        return json.dumps({
            "tx_hash": tx_hash,
            "explorer_url": f"https://testnet.snowtrace.io/tx/{tx_hash}",
            "feedback_index": None,
        })
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def write_reputation_solana(agent_pubkey: str, score: int) -> str:
    """Mint ZK-compressed reputation tokens on Solana via Light Protocol.
    score: number of tokens to mint (1 per successful job, 0 to skip).
    Returns JSON: {tx_hash, compressed, explorer_url}"""
    if score <= 0:
        return json.dumps({"skipped": True, "reason": "score=0, no tokens minted"})
    try:
        # Accept either a raw Solana pubkey or a registry agent ID (e.g. "sol-trust").
        actual_address = AGENT_ADDRESSES.get(agent_pubkey, agent_pubkey)
        result = subprocess.run(
            ["node", ZK_SCRIPT, actual_address, str(score)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return json.dumps({"error": result.stderr.strip()})
        data = json.loads(result.stdout.strip())
        return json.dumps({
            "tx_hash": data.get("sig", ""),
            "compressed": True,
            "explorer_url": data.get("explorer", ""),
        })
    except subprocess.TimeoutExpired:
        return json.dumps({"error": "ZK mint timed out"})
    except Exception as e:
        return json.dumps({"error": str(e)})
