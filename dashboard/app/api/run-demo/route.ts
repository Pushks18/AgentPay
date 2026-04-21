import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const projectRoot = path.resolve(process.cwd(), "..");
  const python = path.join(projectRoot, ".venv", "bin", "python3");

  const args = ["--scenario", scenario, "--input", userInput];

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const push = (s: string) => controller.enqueue(enc.encode(s));

      push(`[AgentPay] Starting scenario: ${scenario}\n`);
      push(`[AgentPay] Input: ${userInput.slice(0, 80)}${userInput.length > 80 ? "..." : ""}\n\n`);

      const child = spawn(python, ["-m", "agent_a.main", ...args], {
        cwd: projectRoot,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      child.stdout.on("data", (data: Buffer) => push(data.toString()));
      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.includes("DeprecationWarning") || text.includes("UserWarning")) return;
        push(text);
      });
      child.on("close", (code) => {
        push(`\n[Done] Exit code: ${code}\n`);
        controller.close();
      });
      child.on("error", (err) => {
        push(`[Error] ${err.message}\n`);
        controller.close();
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
