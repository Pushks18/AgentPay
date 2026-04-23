"use client";

import { useEffect, useRef, useState } from "react";

type DemoState = "idle" | "running" | "done" | "error";

const SCENARIOS = [
  { value: "trust_check",        label: "Trust Check",           desc: "Full trust analysis of a wallet (2 steps)" },
  { value: "audit",              label: "Smart Contract Audit",  desc: "Audit + summarize + SQL schema (3 steps)" },
  { value: "research",           label: "Token Research",        desc: "Market analysis + sentiment + summary (3 steps)" },
  { value: "translate_and_review", label: "Translate & Review",  desc: "Translate code comments + review + explain (3 steps)" },
  { value: "full_pipeline",      label: "Full Pipeline",         desc: "Audit + explain + summarize + SQL + translate ES (5 steps)" },
];

const DEFAULT_INPUTS: Record<string, string> = {
  trust_check: "0xABCDEF1234567890000000000000000000001234",
  audit: "pragma solidity ^0.8.0; contract Vault { mapping(address=>uint) balances; function deposit() external payable { balances[msg.sender] += msg.value; } function withdraw(uint amt) external { require(balances[msg.sender] >= amt); (bool ok,) = msg.sender.call{value: amt}(''); balances[msg.sender] -= amt; } }",
  research: "SOL",
  translate_and_review: "// Cette fonction transfère des tokens\nfunction transferTokens(address to, uint256 amount) external { require(amount > 0); token.transfer(to, amount); }",
  full_pipeline: "pragma solidity ^0.8.0; contract Token { mapping(address=>uint256) public balanceOf; function transfer(address to, uint256 val) external returns (bool) { balanceOf[msg.sender] -= val; balanceOf[to] += val; return true; } }",
};

function classifyLine(line: string): string {
  if (line.startsWith("[AgentPay]")) return "text-gray-500 italic";
  if (line.includes("✓")) return "text-[#00ff88]";
  if (line.includes("✗") || line.toLowerCase().includes("error")) return "text-[#ff4444]";
  if (line.includes("[Step")) return "text-[#ffd700] font-bold";
  if (line.includes("[Agent A] →")) return "text-[#4488ff]";
  if (line.includes("[Agent A] ←")) return "text-[#9945ff]";
  if (line.includes("[Scenario Complete]") || line.includes("RESULT")) return "text-[#00ff88] font-bold";
  if (line.includes("[Done]")) return "text-gray-400";
  if (line.startsWith("  Agent:") || line.startsWith("  Payload:")) return "text-gray-400";
  return "text-gray-300";
}

export function RunDemo() {
  const [state, setState] = useState<DemoState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [scenario, setScenario] = useState("trust_check");
  const [input, setInput] = useState(DEFAULT_INPUTS["trust_check"]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInput(DEFAULT_INPUTS[scenario] ?? "");
  }, [scenario]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  async function checkAgentB(): Promise<{ running: boolean; fuji: boolean; sol: boolean }> {
    try {
      const res = await fetch("/api/agent-b-status", { signal: AbortSignal.timeout(3000) });
      return await res.json();
    } catch {
      return { running: false, fuji: false, sol: false };
    }
  }

  async function runDemo() {
    setState("running");
    setLogs(["[AgentPay] Checking Agent B status…"]);

    // Check if Agent B is running before triggering Agent A
    const status = await checkAgentB();
    if (!status.running) {
      setLogs([
        "❌ Agent B is not running.",
        "",
        "Start it first in your terminal:",
        "",
        "  source .venv/bin/activate",
        "  uvicorn agent_b.main:app_fuji --port 8001 &",
        "  uvicorn agent_b.main:app_sol --port 8002 &",
        "",
        "Or run the one-command startup:",
        "  ./start.sh",
        "",
        "Then click Run again.",
      ]);
      setState("error");
      return;
    }

    setLogs([`[AgentPay] Agent B online (fuji:${status.fuji} sol:${status.sol}). Starting demo…`, ""]);

    try {
      const res = await fetch("/api/run-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, input }),
      });
      if (!res.body) throw new Error("No stream from server");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        setLogs((prev) => [...prev, ...lines].slice(-300));
      }
      setState("done");
      window.dispatchEvent(new CustomEvent("agentpay:refresh"));
    } catch (e) {
      setLogs((prev) => [...prev, `[Error] ${e}`]);
      setState("error");
    }
  }

  const scenarioMeta = SCENARIOS.find((s) => s.value === scenario);

  return (
    <div className="w-full max-w-3xl flex flex-col gap-5">
      {/* Scenario selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-1.5"
            style={{ color: "var(--text-secondary)" }}>
            Scenario
          </label>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            disabled={state === "running"}
            className="w-full px-3 py-2 rounded text-sm font-mono appearance-none cursor-pointer"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              outline: "none",
            }}
          >
            {SCENARIOS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {scenarioMeta && (
            <p className="mt-1 text-[9px] font-mono" style={{ color: "var(--text-secondary)" }}>
              {scenarioMeta.desc}
            </p>
          )}
        </div>

        {/* Input */}
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-1.5"
            style={{ color: "var(--text-secondary)" }}>
            Input
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={state === "running"}
            rows={3}
            className="w-full px-3 py-2 rounded text-xs font-mono resize-none"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Run button */}
      <div className="flex justify-center">
        <button
          onClick={runDemo}
          disabled={state === "running"}
          className="px-10 py-3.5 rounded-xl font-mono font-bold text-base transition-all select-none"
          style={{
            background: state === "running" ? "rgba(0,255,136,0.05)" : "rgba(0,255,136,0.1)",
            border: `2px solid ${state === "running" ? "rgba(0,255,136,0.3)" : "var(--accent-green)"}`,
            color: state === "running" ? "rgba(0,255,136,0.4)" : "var(--accent-green)",
            cursor: state === "running" ? "not-allowed" : "pointer",
            boxShadow: state !== "running" ? "0 0 24px rgba(0,255,136,0.12)" : "none",
          }}
          onMouseEnter={(e) => {
            if (state !== "running") {
              e.currentTarget.style.background = "rgba(0,255,136,0.18)";
              e.currentTarget.style.boxShadow = "0 0 36px rgba(0,255,136,0.25)";
            }
          }}
          onMouseLeave={(e) => {
            if (state !== "running") {
              e.currentTarget.style.background = "rgba(0,255,136,0.1)";
              e.currentTarget.style.boxShadow = "0 0 24px rgba(0,255,136,0.12)";
            }
          }}
        >
          {state === "running" ? (
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
              Running...
            </span>
          ) : state === "done" ? "▶ Run Again" : state === "error" ? "▶ Retry" : "▶ Run Live Demo"}
        </button>
      </div>

      {/* Terminal log */}
      {logs.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {/* Terminal chrome */}
          <div className="flex items-center gap-2 px-4 py-2.5"
            style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-3 text-[10px] font-mono" style={{ color: "var(--text-secondary)" }}>
              agent_a — {scenarioMeta?.label ?? scenario}
            </span>
            <div className="ml-auto flex items-center gap-2 text-[9px] font-mono" style={{ color: "var(--text-secondary)" }}>
              {state === "running" && <span className="text-[#00ff88] animate-pulse">● LIVE</span>}
              {state === "done" && <span className="text-[#00ff88]">✓ DONE</span>}
              {state === "error" && <span className="text-[#ff4444]">✗ ERROR</span>}
            </div>
          </div>
          {/* Log body */}
          <div
            ref={logRef}
            className="terminal-text p-4 text-xs overflow-y-auto"
            style={{ background: "#050505", height: 260 }}
          >
            {logs.map((line, i) => (
              <div key={i} className={`leading-5 ${classifyLine(line)}`}>
                {line || " "}
              </div>
            ))}
            {state === "running" && (
              <span className="cursor-blink text-[#00ff88]">█</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
