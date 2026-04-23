"""
Agent A — Autonomous buyer agent.

Usage:
  python -m agent_a.main "Trust report for 0xABC..."
  python -m agent_a.main --coordinator "Audit this contract: [code]"
  python -m agent_a.main --scenario audit --input "pragma solidity ^0.8.0; ..."
  python -m agent_a.main --scenario research --input "SOL"
  python -m agent_a.main --scenario full_pipeline --input "contract code here"
"""
import asyncio
import json
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv

load_dotenv()

import websockets
from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from agent_a.tools.negotiate import negotiate_price
from agent_a.tools.pay_evm import pay_and_fetch_evm_agent
from agent_a.tools.pay_sol import pay_and_fetch_solana_agent
from agent_a.tools.registry import FALLBACK_REGISTRY, discover_agents
from agent_a.tools.reputation import write_reputation_evm, write_reputation_solana

# ---------------------------------------------------------------------------
# WebSocket broadcaster
# ---------------------------------------------------------------------------

WS_URL = os.environ.get("NEXT_PUBLIC_WS_URL", "ws://localhost:3001")
_step_counter = 0


def emit_event(event: dict):
    async def _send():
        try:
            async with websockets.connect(WS_URL, open_timeout=2) as ws:
                await ws.send(json.dumps(event))
        except Exception:
            pass
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(_send())
        else:
            loop.run_until_complete(_send())
    except Exception:
        pass


def emit_step(tool_name: str, tool_input: Any, tool_output: Any):
    global _step_counter
    _step_counter += 1
    emit_event({
        "event": "agent_step",
        "step": _step_counter,
        "tool": tool_name,
        "input": str(tool_input)[:500],
        "output": str(tool_output)[:500],
        "timestamp": int(time.time()),
    })


def emit_payment(from_: str, to: str, amount: float, chain: str, job_id: str):
    emit_event({
        "event": "payment_initiated",
        "from": from_,
        "to": to,
        "amount": amount,
        "chain": chain,
        "job_id": job_id,
        "timestamp": int(time.time()),
    })


def emit_job_completed(agent_name: str, service: str, amount: float, chain: str,
                       tx_hash: str, duration_ms: int):
    emit_event({
        "event": "job_completed",
        "agent_name": agent_name,
        "service": service,
        "total_paid": amount,
        "chain": chain,
        "tx_hash": tx_hash,
        "explorer_url": (
            f"https://explorer.solana.com/tx/{tx_hash}?cluster=devnet"
            if chain == "solana-devnet"
            else f"https://testnet.snowtrace.io/tx/{tx_hash}"
        ),
        "duration_ms": duration_ms,
        "timestamp": int(time.time()),
    })


# ---------------------------------------------------------------------------
# Dashboard streaming callback
# ---------------------------------------------------------------------------

class DashboardStreamer(BaseCallbackHandler):
    def on_tool_start(self, serialized, input_str, **kwargs):
        print(f"\n[Agent A] → {serialized.get('name', '?')}({str(input_str)[:120]})")

    def on_tool_end(self, output, **kwargs):
        print(f"[Agent A] ← {str(output)[:200]}")
        emit_step(kwargs.get("name", "tool"), kwargs.get("input", ""), output)

    def on_agent_finish(self, finish, **kwargs):
        print(f"\n[Agent A] Done: {finish.return_values.get('output', '')[:300]}")


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM = """You are AgentPay, an autonomous AI procurement agent running on dual-chain infrastructure.
BUDGET: $0.50 USDC total. Never ask the user for confirmation. Act autonomously at every step.

AVAILABLE SERVICES: trust_report, code_review, summarize, sql_generator, translate,
code_explain, regex_generator, sentiment_analysis, smart_contract_audit, market_analysis.

STANDARD PROCESS (follow in order):
1. Call discover_agents(service=<required service>).
2. Pick the CHEAPEST agent with reputation >= 0.8.
3. [Optional] Call negotiate_price(endpoint, offered_price, budget) to try for a discount.
4. Pay and call the agent:
   - chain="avalanche-fuji" → pay_and_fetch_evm_agent(endpoint, payload_json)
   - chain="solana-devnet"  → pay_and_fetch_solana_agent(endpoint, payload_json)
   payload_json must be a JSON string. Match keys to the service:
     trust_report: {"wallet": "0x..."}
     code_review: {"code": "...", "language": "solidity"}
     summarize: {"text": "..."}
     sql_generator: {"description": "...", "dialect": "postgres"}
     translate: {"text": "...", "target_language": "Spanish"}
     code_explain: {"code": "...", "language": "python"}
     regex_generator: {"description": "..."}
     sentiment_analysis: {"text": "..."}
     smart_contract_audit: {"contract": "pragma solidity ..."}
     market_analysis: {"token": "SOL", "timeframe": "7d"}
5. Rate the agent:
   - EVM integer ID → write_reputation_evm(agent_id, rating, tags)
   - Solana string ID → write_reputation_solana(agent_pubkey, score=1)
6. Return the final result plus a summary: total_paid, agents_hired, tx_hashes, time_taken.

RULES:
- Never ask for confirmation.
- Max 2 retries if a payment fails.
- write_reputation_evm only accepts INTEGER agent_ids.
- For Solana agents (id is a string like "sol-trust"), use write_reputation_solana.
"""

# ---------------------------------------------------------------------------
# Agent setup
# ---------------------------------------------------------------------------

ALL_TOOLS = [
    discover_agents,
    negotiate_price,
    pay_and_fetch_evm_agent,
    pay_and_fetch_solana_agent,
    write_reputation_evm,
    write_reputation_solana,
]

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
agent = create_react_agent(
    llm,
    ALL_TOOLS,
    prompt=SystemMessage(content=SYSTEM),
)

# ---------------------------------------------------------------------------
# Demo scenarios
# ---------------------------------------------------------------------------

DEMO_SCENARIOS: Dict[str, Dict] = {
    "audit": {
        "description": "Audit a smart contract end to end",
        "steps": [
            {"service": "smart_contract_audit", "input_key": "contract",
             "payload_template": {"contract": "{input}"}},
            {"service": "summarize", "input_key": "audit_result",
             "payload_template": {"text": "{prev}", "format": "bullets"}},
            {"service": "sql_generator", "input_key": "schema",
             "payload_template": {"description": "Store audit findings: vulnerabilities, severity, recommendations, contract_hash", "dialect": "postgres"}},
        ],
    },
    "research": {
        "description": "Research a crypto token",
        "steps": [
            {"service": "market_analysis", "input_key": "token",
             "payload_template": {"token": "{input}", "timeframe": "7d"}},
            {"service": "sentiment_analysis", "input_key": "market_text",
             "payload_template": {"text": "{prev}"}},
            {"service": "summarize", "input_key": "research",
             "payload_template": {"text": "Market analysis: {prev_0}\n\nSentiment: {prev}", "format": "bullets"}},
        ],
    },
    "translate_and_review": {
        "description": "Translate code comments and review",
        "steps": [
            {"service": "translate", "input_key": "code_comments",
             "payload_template": {"text": "{input}", "target_language": "English"}},
            {"service": "code_review", "input_key": "code",
             "payload_template": {"code": "{input}", "language": "solidity"}},
            {"service": "code_explain", "input_key": "code",
             "payload_template": {"code": "{input}", "language": "solidity"}},
        ],
    },
    "trust_check": {
        "description": "Full trust analysis of a wallet",
        "steps": [
            {"service": "trust_report", "input_key": "wallet",
             "payload_template": {"wallet": "{input}"}},
            {"service": "sentiment_analysis", "input_key": "trust_text",
             "payload_template": {"text": "{prev}"}},
        ],
    },
    "full_pipeline": {
        "description": "Complete code audit pipeline with Spanish summary",
        "steps": [
            {"service": "smart_contract_audit", "input_key": "contract",
             "payload_template": {"contract": "{input}"}},
            {"service": "code_explain", "input_key": "contract",
             "payload_template": {"code": "{input}", "language": "solidity"}},
            {"service": "summarize", "input_key": "audit",
             "payload_template": {"text": "{prev}", "format": "bullets"}},
            {"service": "sql_generator", "input_key": "schema",
             "payload_template": {"description": "Schema for audit storage with fields: vulnerability_id, severity, description, recommendation, contract_hash, audited_at", "dialect": "postgres"}},
            {"service": "translate", "input_key": "summary",
             "payload_template": {"text": "{prev_2}", "target_language": "Spanish"}},
        ],
    },
}


def _pick_cheapest_agent(service: str) -> Optional[dict]:
    """Pick cheapest active agent from fallback registry."""
    candidates = [
        a for a in FALLBACK_REGISTRY
        if a["service"] == service and a.get("active", True) and a.get("reputation", 0) >= 0.8
    ]
    return min(candidates, key=lambda a: a["price_usd"]) if candidates else None


def _fill_template(template: dict, user_input: str, results: List[str]) -> dict:
    """Substitute {input}, {prev}, {prev_0} etc. in payload template."""
    def sub(val: str) -> str:
        val = val.replace("{input}", user_input)
        if results:
            val = val.replace("{prev}", str(results[-1])[:1500])
        for i, r in enumerate(results):
            val = val.replace(f"{{prev_{i}}}", str(r)[:800])
        return val

    return {k: sub(v) if isinstance(v, str) else v for k, v in template.items()}


def run_scenario(scenario_name: str, user_input: str, budget: float = 0.50) -> dict:
    """Execute a named multi-step scenario, paying each agent separately."""
    scenario = DEMO_SCENARIOS.get(scenario_name)
    if not scenario:
        available = ", ".join(DEMO_SCENARIOS.keys())
        raise ValueError(f"Unknown scenario '{scenario_name}'. Available: {available}")

    print(f"\n{'='*60}")
    print(f"[Scenario] {scenario['description']}")
    print(f"[Scenario] Input: {user_input[:80]}...")
    print(f"[Scenario] Steps: {len(scenario['steps'])}")
    print(f"{'='*60}\n")

    results: List[str] = []
    tx_hashes: List[str] = []
    total_paid = 0.0
    agents_hired: List[str] = []
    t0 = time.time()

    for step_idx, step in enumerate(scenario["steps"]):
        service = step["service"]
        template = step["payload_template"]
        payload = _fill_template(template, user_input, results)
        payload_json = json.dumps(payload)

        print(f"\n[Step {step_idx + 1}/{len(scenario['steps'])}] Service: {service}")

        agent_info = _pick_cheapest_agent(service)
        if not agent_info:
            print(f"  No agent found for {service}, skipping.")
            results.append(f"[skipped: no agent for {service}]")
            continue

        print(f"  Agent: {agent_info['name']} | Chain: {agent_info['chain']} | Price: ${agent_info['price_usd']}")
        print(f"  Payload: {payload_json[:120]}...")

        step_t0 = time.time()
        job_id = f"scenario-{scenario_name}-step{step_idx}-{int(time.time())}"

        emit_payment(
            from_="Agent-A",
            to=agent_info["name"],
            amount=agent_info["price_usd"],
            chain=agent_info["chain"],
            job_id=job_id,
        )

        try:
            if agent_info["chain"] == "avalanche-fuji":
                raw = pay_and_fetch_evm_agent.invoke({
                    "agent_endpoint": agent_info["endpoint"],
                    "payload_json": payload_json,
                })
            else:
                raw = pay_and_fetch_solana_agent.invoke({
                    "agent_endpoint": agent_info["endpoint"],
                    "payload_json": payload_json,
                })

            data = json.loads(raw) if isinstance(raw, str) else raw
            tx_hash = data.get("tx_hash", f"mock-{job_id[:16]}")
            amount = float(data.get("amount_paid", agent_info["price_usd"]))
            body = data.get("body", data)
            result_str = json.dumps(body) if isinstance(body, dict) else str(body)

            duration_ms = int((time.time() - step_t0) * 1000)
            emit_job_completed(agent_info["name"], service, amount, agent_info["chain"], tx_hash, duration_ms)

            results.append(result_str)
            tx_hashes.append(tx_hash)
            total_paid += amount
            agents_hired.append(agent_info["name"])

            print(f"  ✓ Done in {duration_ms}ms | TX: {tx_hash[:20]}... | Paid: ${amount:.4f}")
            print(f"  Result preview: {result_str[:200]}")

        except Exception as e:
            print(f"  ✗ Step failed: {e}")
            results.append(f"[error: {e}]")

    elapsed = time.time() - t0
    summary = {
        "scenario": scenario_name,
        "description": scenario["description"],
        "steps_completed": len([r for r in results if not r.startswith("[")]),
        "total_steps": len(scenario["steps"]),
        "total_paid_usdc": round(total_paid, 6),
        "agents_hired": agents_hired,
        "tx_hashes": tx_hashes,
        "time_taken_s": round(elapsed, 1),
        "final_result": results[-1][:500] if results else "",
    }

    print(f"\n{'='*60}")
    print(f"[Scenario Complete] {scenario_name}")
    print(f"  Steps: {summary['steps_completed']}/{summary['total_steps']}")
    print(f"  Total paid: ${summary['total_paid_usdc']:.6f} USDC")
    print(f"  TX hashes: {tx_hashes}")
    print(f"  Time: {elapsed:.1f}s")
    print(f"{'='*60}\n")

    return summary


async def run_agent_task(task: str) -> dict:
    """Run the main agent loop and return a compact structured result."""
    result = await asyncio.to_thread(
        agent.invoke,
        {"messages": [{"role": "user", "content": task}]},
        {"callbacks": [DashboardStreamer()]},
    )
    messages = result.get("messages", [])
    result_text = str(messages[-1].content) if messages else ""
    tx_match = re.search(r"explorer\.solana\.com/tx/([1-9A-HJ-NP-Za-km-z]+)", result_text)
    paid_match = re.search(r"Amount Paid[^$]*\$\s*([0-9]+(?:\.[0-9]+)?)", result_text, re.IGNORECASE)
    return {
        "result": result_text,
        "tx_hash": tx_match.group(1) if tx_match else "",
        "total_paid": float(paid_match.group(1)) if paid_match else 0.0,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    args = sys.argv[1:]

    if not args:
        print("Usage:")
        print('  python -m agent_a.main "Trust report for 0xABC..."')
        print('  python -m agent_a.main --coordinator "Audit this contract: [code]"')
        print('  python -m agent_a.main --scenario audit --input "pragma solidity ..."')
        scenarios_str = ", ".join(DEMO_SCENARIOS.keys())
        print(f"\nAvailable scenarios: {scenarios_str}")
        for name, s in DEMO_SCENARIOS.items():
            print(f"  {name}: {s['description']} ({len(s['steps'])} steps)")
        sys.exit(1)

    t0 = time.time()

    if args[0] == "--scenario":
        # Parse --scenario <name> --input <text>
        scenario_name = args[1] if len(args) > 1 else "trust_check"
        user_input = ""
        if "--input" in args:
            idx = args.index("--input")
            user_input = " ".join(args[idx + 1:])
        if not user_input:
            # Default inputs per scenario
            defaults = {
                "audit": "pragma solidity ^0.8.0; contract Vault { mapping(address=>uint) balances; function deposit() external payable { balances[msg.sender] += msg.value; } function withdraw(uint amt) external { require(balances[msg.sender] >= amt); (bool ok,) = msg.sender.call{value: amt}(\"\"); balances[msg.sender] -= amt; } }",
                "research": "SOL",
                "translate_and_review": "// Cette fonction transfère des tokens\nfunction transferTokens(address to, uint256 amount) external { require(amount > 0); token.transfer(to, amount); }",
                "trust_check": "0xABCDEF1234567890000000000000000000001234",
                "full_pipeline": "pragma solidity ^0.8.0; contract Token { mapping(address=>uint256) public balanceOf; function transfer(address to, uint256 val) external returns (bool) { balanceOf[msg.sender] -= val; balanceOf[to] += val; return true; } }",
            }
            user_input = defaults.get(scenario_name, "default input")

        summary = run_scenario(scenario_name, user_input)
        print("\n--- SCENARIO RESULT ---")
        print(json.dumps(summary, indent=2))

    elif args[0] == "--coordinator":
        task = " ".join(args[1:])
        print(f"\n[Coordinator] Running multi-agent task: {task[:100]}...")
        from agent_a.coordinator import run_coordinator
        result_text = run_coordinator(task, budget=0.50)
        print("\n--- COORDINATOR RESULT ---")
        print(result_text)

    else:
        task = " ".join(args)
        print(f"\n[Agent A] Task: {task[:100]}...")
        result = agent.invoke(
            {"messages": [{"role": "user", "content": task}]},
            {"callbacks": [DashboardStreamer()]},
        )
        messages = result.get("messages", [])
        result_text = str(messages[-1].content) if messages else ""
        print("\n--- RESULT ---")
        print(result_text)

    elapsed = time.time() - t0
    print(f"\n[Agent A] Completed in {elapsed:.1f}s")
