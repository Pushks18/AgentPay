"""
Multi-agent coordinator: decomposes complex tasks into a DAG of subtasks,
executes independent subtasks in parallel, then synthesises results.
"""
import asyncio
import json
import os
import time
from typing import Annotated, Any, Dict, List, Optional, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from agent_a.tools.pay_evm import pay_and_fetch_evm_agent
from agent_a.tools.pay_sol import pay_and_fetch_solana_agent
from agent_a.tools.registry import discover_agents

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

SERVICE_TO_ENDPOINT_KEY = {
    "trust_report": "trust_report",
    "code_review": "code_review",
    "summarize": "summarize",
    "sql_generator": "sql_generator",
}


class Subtask(TypedDict):
    id: str
    service: str
    input: str
    depends_on: List[str]  # ids of subtasks whose output feeds this one
    result: Optional[str]
    status: str  # pending | running | done | failed


class CoordinatorState(TypedDict):
    task: str
    budget: float
    spent: float
    subtasks: List[Subtask]
    results: Dict[str, str]
    final_report: str
    error: Optional[str]


# ---------------------------------------------------------------------------
# LLM
# ---------------------------------------------------------------------------

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)


# ---------------------------------------------------------------------------
# Node: decompose task into subtasks
# ---------------------------------------------------------------------------

def decompose(state: CoordinatorState) -> CoordinatorState:
    system = """You are a task decomposition agent. Break a complex task into subtasks.
Each subtask must map to ONE of these services: trust_report, code_review, summarize, sql_generator.
Return ONLY valid JSON:
{
  "subtasks": [
    {
      "id": "t1",
      "service": "code_review",
      "input": "...",
      "depends_on": []
    },
    {
      "id": "t2",
      "service": "summarize",
      "input": "Summarize the findings from {t1}",
      "depends_on": ["t1"]
    }
  ]
}
Use {tid} placeholders for dependent inputs. Keep subtasks minimal."""

    resp = llm.invoke([
        SystemMessage(content=system),
        HumanMessage(content=f"Task: {state['task']}\nBudget: ${state['budget']} USDC"),
    ])

    try:
        data = json.loads(resp.content)
        subtasks: List[Subtask] = [
            {**st, "result": None, "status": "pending"}
            for st in data["subtasks"]
        ]
    except Exception:
        # Fallback: single trust_report subtask
        subtasks = [{
            "id": "t1",
            "service": "trust_report",
            "input": state["task"],
            "depends_on": [],
            "result": None,
            "status": "pending",
        }]

    return {**state, "subtasks": subtasks}


# ---------------------------------------------------------------------------
# Helper: find cheapest agent for a service
# ---------------------------------------------------------------------------

def _pick_agent(service: str) -> Optional[dict]:
    raw = discover_agents.invoke({"service": service})
    agents = json.loads(raw)
    if not agents:
        return None
    return agents[0]  # already sorted by price in discover_agents


# ---------------------------------------------------------------------------
# Helper: execute a single subtask
# ---------------------------------------------------------------------------

def _resolve_input(input_str: str, results: Dict[str, str]) -> str:
    for tid, result in results.items():
        input_str = input_str.replace(f"{{{tid}}}", result[:500])
    return input_str


async def _execute_subtask(subtask: Subtask, results: Dict[str, str], spent: float) -> tuple[str, float]:
    """Returns (result_str, amount_paid)."""
    agent = _pick_agent(subtask["service"])
    if not agent:
        return json.dumps({"error": f"no agent found for {subtask['service']}"}), 0.0

    resolved_input = _resolve_input(subtask["input"], results)
    payload = json.dumps({"content": resolved_input, "wallet": resolved_input,
                          "code": resolved_input, "text": resolved_input,
                          "description": resolved_input, "language": "solidity",
                          "format": "bullets", "dialect": "postgres"})

    if agent["chain"] == "avalanche-fuji":
        raw = pay_and_fetch_evm_agent.invoke({
            "agent_endpoint": agent["endpoint"],
            "payload_json": payload,
        })
    else:
        raw = pay_and_fetch_solana_agent.invoke({
            "agent_endpoint": agent["endpoint"],
            "payload_json": payload,
        })

    data = json.loads(raw)
    amount = float(data.get("amount_paid", agent["price_usd"]))
    if "error" in data:
        return raw, 0.0
    return json.dumps(data.get("body", data)), amount


# ---------------------------------------------------------------------------
# Node: execute all ready subtasks in parallel
# ---------------------------------------------------------------------------

def execute_parallel(state: CoordinatorState) -> CoordinatorState:
    subtasks = state["subtasks"]
    results = dict(state["results"])
    spent = state["spent"]

    # Find all subtasks whose dependencies are satisfied
    ready = [
        st for st in subtasks
        if st["status"] == "pending"
        and all(dep in results for dep in st["depends_on"])
    ]

    if not ready:
        return state

    async def _run_all():
        tasks = [_execute_subtask(st, results, spent) for st in ready]
        return await asyncio.gather(*tasks)

    loop = asyncio.new_event_loop()
    outcomes = loop.run_until_complete(_run_all())
    loop.close()

    for subtask, (result, amount) in zip(ready, outcomes):
        subtask["result"] = result
        subtask["status"] = "done"
        results[subtask["id"]] = result
        spent += amount

    return {**state, "subtasks": subtasks, "results": results, "spent": spent}


# ---------------------------------------------------------------------------
# Node: check if more subtasks remain
# ---------------------------------------------------------------------------

def should_continue(state: CoordinatorState) -> str:
    remaining = [st for st in state["subtasks"] if st["status"] == "pending"]
    if not remaining:
        return "synthesize"
    if state["spent"] >= state["budget"]:
        return "synthesize"
    return "execute_parallel"


# ---------------------------------------------------------------------------
# Node: synthesise final answer
# ---------------------------------------------------------------------------

def synthesise(state: CoordinatorState) -> CoordinatorState:
    results_summary = "\n\n".join(
        f"[{st['id']} / {st['service']}]:\n{st.get('result', 'no result')[:800]}"
        for st in state["subtasks"]
    )
    resp = llm.invoke([
        SystemMessage(content="You synthesise multi-agent job results into a clean final report."),
        HumanMessage(content=(
            f"Original task: {state['task']}\n\n"
            f"Subtask results:\n{results_summary}\n\n"
            "Write a concise final report."
        )),
    ])
    return {**state, "final_report": resp.content}


# ---------------------------------------------------------------------------
# Node: generate job report
# ---------------------------------------------------------------------------

def report(state: CoordinatorState) -> CoordinatorState:
    print(f"\n{'='*60}")
    print(f"[Coordinator] Task complete")
    print(f"  Subtasks   : {len(state['subtasks'])}")
    print(f"  Total spent: ${state['spent']:.6f} USDC")
    print(f"  Budget used: {state['spent'] / state['budget'] * 100:.1f}%")
    print(f"{'='*60}\n")
    return state


# ---------------------------------------------------------------------------
# Build the LangGraph
# ---------------------------------------------------------------------------

def build_coordinator() -> Any:
    graph = StateGraph(CoordinatorState)

    graph.add_node("decompose", decompose)
    graph.add_node("execute_parallel", execute_parallel)
    graph.add_node("synthesize", synthesise)
    graph.add_node("report", report)

    graph.set_entry_point("decompose")
    graph.add_edge("decompose", "execute_parallel")
    graph.add_conditional_edges("execute_parallel", should_continue)
    graph.add_edge("synthesize", "report")
    graph.add_edge("report", END)

    return graph.compile()


coordinator = build_coordinator()


def run_coordinator(task: str, budget: float = 0.50) -> str:
    initial: CoordinatorState = {
        "task": task,
        "budget": budget,
        "spent": 0.0,
        "subtasks": [],
        "results": {},
        "final_report": "",
        "error": None,
    }
    final = coordinator.invoke(initial)
    return final["final_report"]
