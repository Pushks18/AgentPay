import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RENDER_URL = process.env.AGENT_B_RENDER_URL ?? "https://agentpay-o5zt.onrender.com";

const SCENARIO_DEFAULTS: Record<string, string> = {
  audit:
    "pragma solidity ^0.8.0; contract Vault { mapping(address=>uint) balances; function deposit() external payable { balances[msg.sender] += msg.value; } function withdraw(uint amt) external { require(balances[msg.sender] >= amt); (bool ok,) = msg.sender.call{value: amt}(''); balances[msg.sender] -= amt; } }",
  research: "SOL",
  translate_and_review:
    "// Cette fonction transfère des tokens\nfunction transferTokens(address to, uint256 amount) external { require(amount > 0); token.transfer(to, amount); }",
  trust_check: "0xABCDEF1234567890000000000000000000001234",
  full_pipeline:
    "pragma solidity ^0.8.0; contract Token { mapping(address=>uint256) public balanceOf; function transfer(address to, uint256 val) external returns (bool) { balanceOf[msg.sender] -= val; balanceOf[to] += val; return true; } }",
};

export async function POST(req: NextRequest) {
  let scenario = "trust_check";
  let userInput = "";

  try {
    const body = await req.json();
    scenario = body.scenario ?? "trust_check";
    userInput = body.input ?? "";
  } catch {}

  if (!userInput) userInput = SCENARIO_DEFAULTS[scenario] ?? "";

  const upstream = await fetch(`${RENDER_URL}/run-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service: scenario, input: userInput, scenario }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(`[Error] Render run-agent failed (${upstream.status}) ${text}\n`, {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
