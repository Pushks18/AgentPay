import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RENDER_URL = process.env.AGENT_B_RENDER_URL ?? "https://agentpay-o5zt.onrender.com";

export async function POST(req: NextRequest) {
  let agentService = "trust_report";
  let agentEndpoint = "";
  let pubkey = "";

  try {
    const body = await req.json();
    agentService = body.agentService ?? "trust_report";
    agentEndpoint = body.agentEndpoint ?? "";
    pubkey = body.pubkey ?? "";
  } catch {}

  // Map service to scenario
  const SERVICE_TO_SCENARIO: Record<string, string> = {
    trust_report: "trust_check",
    smart_contract_audit: "audit",
    market_analysis: "research",
    translate: "translate_and_review",
    code_review: "translate_and_review",
  };

  const SERVICE_DEFAULTS: Record<string, string> = {
    trust_report: pubkey || "5xVH2U4UFX6jDk3w12EzGhQSFr2jwGmfs7ET59ooCiZu",
    smart_contract_audit: "pragma solidity ^0.8.0; contract Vault { mapping(address=>uint) balances; function deposit() external payable { balances[msg.sender] += msg.value; } function withdraw(uint amt) external { require(balances[msg.sender] >= amt); (bool ok,) = msg.sender.call{value: amt}(\"\"); balances[msg.sender] -= amt; } }",
    market_analysis: "SOL",
    translate: "// Cette fonction transfère des tokens\nfunction transferTokens(address to, uint256 amount) external { require(amount > 0); token.transfer(to, amount); }",
    code_review: "function add(a, b) { return a + b }",
  };

  const scenario = SERVICE_TO_SCENARIO[agentService] ?? "trust_check";
  const input = SERVICE_DEFAULTS[agentService] ?? agentService;

  const upstream = await fetch(`${RENDER_URL}/run-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service: agentService, input, scenario }),
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
