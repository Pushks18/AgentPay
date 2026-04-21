"""
negotiate_price: Agent A offers a price to Agent B and reaches an agreement.
Agent B must expose POST /negotiate → {accepted: bool, counter_price: float}.
"""
import json
import os

import httpx
from langchain_core.tools import tool


@tool
def negotiate_price(endpoint: str, offered_price: float, budget: float) -> str:
    """Negotiate price with an Agent B service before committing to payment.
    endpoint: base URL of Agent B (e.g. http://localhost:8001).
    offered_price: Agent A's opening offer in USDC.
    budget: absolute maximum Agent A will pay.
    Returns JSON: {agreed_price, accepted, final_endpoint, negotiation_rounds}"""
    negotiate_url = endpoint.rstrip("/").rsplit("/", 1)[0] + "/negotiate"
    current_offer = offered_price
    max_acceptable = budget * 1.2  # allow 20% above budget before walking away
    rounds = 0

    for _ in range(3):  # max 3 rounds
        rounds += 1
        try:
            resp = httpx.post(
                negotiate_url,
                json={"offered_price": current_offer, "budget": budget},
                timeout=10,
            )
            if resp.status_code == 404:
                # Agent B has no /negotiate — accept listed price if within budget
                if current_offer <= budget:
                    return json.dumps({
                        "agreed_price": current_offer,
                        "accepted": True,
                        "final_endpoint": endpoint,
                        "negotiation_rounds": 0,
                    })
                return json.dumps({"accepted": False, "reason": "no negotiate endpoint, price over budget"})

            data = resp.json()
            if data.get("accepted"):
                return json.dumps({
                    "agreed_price": current_offer,
                    "accepted": True,
                    "final_endpoint": endpoint,
                    "negotiation_rounds": rounds,
                })

            counter = float(data.get("counter_price", current_offer * 1.1))
            if counter <= max_acceptable:
                return json.dumps({
                    "agreed_price": counter,
                    "accepted": True,
                    "final_endpoint": endpoint,
                    "negotiation_rounds": rounds,
                })

            # Split the difference for next round
            current_offer = (current_offer + counter) / 2

        except httpx.TimeoutException:
            break
        except Exception as e:
            return json.dumps({"accepted": False, "error": str(e)})

    return json.dumps({
        "accepted": False,
        "reason": f"no agreement after {rounds} rounds",
    })
