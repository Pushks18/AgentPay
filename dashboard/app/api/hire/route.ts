import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const projectRoot = path.resolve(process.cwd(), "..");
  const python = path.join(projectRoot, ".venv", "bin", "python3");

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const push = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch {} };

      push(`[AgentPay] Hiring agent for service: ${agentService}\n`);
      push(`[AgentPay] Running scenario: ${scenario}\n\n`);

      const child = spawn(
        python,
        ["-m", "agent_a.main", "--scenario", scenario, "--input", input],
        {
          cwd: projectRoot,
          env: { ...process.env, PYTHONUNBUFFERED: "1" },
        }
      );

      child.stdout.on("data", (data: Buffer) => push(data.toString()));
      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.includes("DeprecationWarning") || text.includes("UserWarning")) return;
        push(text);
      });
      child.on("close", (code) => {
        push(`\n[Done] Agent completed. Exit code: ${code}\n`);
        try { controller.close(); } catch {}
      });
      child.on("error", (err) => {
        push(`[Error] ${err.message}\n`);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
