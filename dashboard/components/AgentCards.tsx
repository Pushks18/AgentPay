"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface Agent {
  id: string | number;
  name: string;
  reputation: number;
  chain: "avalanche-fuji" | "solana-devnet";
  service: string;
  priceUsd: number;
  txCount: number;
  tags: string[];
  lastJobTimestamp?: number;
  endpoint?: string;
  pda?: string;
}

const SERVICE_ICONS: Record<string, string> = {
  smart_contract_audit: "🔍",
  trust_report:         "🛡️",
  sentiment_analysis:   "📊",
  market_analysis:      "📈",
  code_review:          "💻",
  code_explain:         "📖",
  translate:            "🌐",
  sql_generator:        "🗄️",
  regex_generator:      "🔤",
  summarize:            "✂️",
};

const SERVICE_TAGS: Record<string, string[]> = {
  smart_contract_audit: ["solidity", "audit", "EVM"],
  trust_report:         ["wallet", "risk", "on-chain"],
  sentiment_analysis:   ["NLP", "analysis"],
  market_analysis:      ["DeFi", "trading", "crypto"],
  code_review:          ["solidity", "review"],
  code_explain:         ["NLP", "explain"],
  translate:            ["i18n", "NLP"],
  sql_generator:        ["SQL", "schema"],
  regex_generator:      ["regex", "pattern"],
  summarize:            ["NLP", "summary"],
};

function repColor(rep: number) {
  if (rep >= 0.9) return { fill: "#ffd700", glow: "rgba(255,215,0,0.4)" };
  if (rep >= 0.8) return { fill: "#c0c0c0", glow: "rgba(192,192,192,0.3)" };
  return { fill: "#cd7f32", glow: "rgba(205,127,50,0.3)" };
}

// Normalize raw API agent → display Agent
function normalizeAgent(raw: any): Agent {
  const rep = raw.reputation > 1 ? raw.reputation / 1000 : raw.reputation;
  return {
    id: raw.id ?? raw.pda ?? raw.name,
    name: raw.name,
    reputation: rep,
    chain: raw.chain ?? "solana-devnet",
    service: raw.service,
    priceUsd: raw.price_usd ?? raw.priceUsd ?? 0,
    txCount: raw.tx_count ?? raw.txCount ?? raw.totalJobs ?? 0,
    tags: SERVICE_TAGS[raw.service] ?? [],
    endpoint: raw.endpoint,
    pda: raw.pda,
  };
}

function ChainBadge({ chain }: { chain: Agent["chain"] }) {
  const isSol = chain === "solana-devnet";
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-mono"
      style={{
        background: isSol ? "rgba(153,69,255,0.12)" : "rgba(232,65,66,0.12)",
        color: isSol ? "#9945ff" : "#e84142",
        border: `1px solid ${isSol ? "rgba(153,69,255,0.3)" : "rgba(232,65,66,0.3)"}`,
      }}
    >
      {isSol ? "SOL" : "AVAX"}
    </span>
  );
}

function ReputationBar({ reputation }: { reputation: number }) {
  const pct = reputation * 100;
  const { fill } = repColor(reputation);
  return (
    <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: fill }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 1.4, ease: "easeOut", delay: 0.3 }}
      />
    </div>
  );
}

function AgentCard({ agent, onHire }: { agent: Agent; onHire: (a: Agent) => void }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 5000);
    return () => clearInterval(id);
  }, []);

  const isLive = !!agent.lastJobTimestamp && (now - agent.lastJobTimestamp) < 60;
  const { fill, glow } = repColor(agent.reputation);
  const icon = SERVICE_ICONS[agent.service] || "🤖";
  const repScore = Math.round(agent.reputation * 1000);

  return (
    <motion.div
      className="card-lift rounded-xl p-4 flex flex-col gap-2.5 cursor-default"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
      whileHover={{ boxShadow: `0 0 0 1px rgba(0,255,136,0.3), 0 8px 28px rgba(0,255,136,0.08)` }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <div>
            <div className="text-xs font-mono text-white font-medium leading-tight">{agent.name}</div>
            <div className="text-[9px] font-mono" style={{ color: "var(--text-secondary)" }}>
              {agent.service.replace(/_/g, " ")}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs font-mono font-bold" style={{ color: "var(--accent-green)" }}>
            ${agent.priceUsd.toFixed(3)}
          </span>
          {isLive && (
            <span className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "var(--accent-green)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {agent.tags.map((t) => (
          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded font-mono"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            {t}
          </span>
        ))}
        <ChainBadge chain={agent.chain} />
      </div>

      {/* Reputation bar */}
      <div>
        <ReputationBar reputation={agent.reputation} />
        <div className="flex justify-between items-center mt-1">
          <span className="text-[9px] font-mono" style={{ color: fill }}>
            {repScore}/1000
          </span>
          <span className="text-[9px] font-mono" style={{ color: "var(--text-secondary)" }}>
            {agent.txCount.toLocaleString()} txs
          </span>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={() => onHire(agent)}
        className="w-full py-1.5 rounded text-[10px] font-mono font-medium transition-all"
        style={{
          background: "rgba(0,255,136,0.07)",
          border: "1px solid rgba(0,255,136,0.2)",
          color: "var(--accent-green)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0,255,136,0.15)";
          e.currentTarget.style.boxShadow = `0 0 12px ${glow}`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(0,255,136,0.07)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        ▶ Use Agent
      </button>
    </motion.div>
  );
}

// Inline terminal for live hire output
function HireTerminal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    setLogs([`[AgentPay] Hiring ${agent.name} for ${agent.service}...`, ""]);

    fetch("/api/hire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentService: agent.service, agentEndpoint: agent.endpoint, pubkey: String(agent.id) }),
    }).then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (active) {
        const { done: d, value } = await reader.read();
        if (d) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        setLogs((prev) => [...prev, ...lines].slice(-200));
      }
      if (active) {
        setDone(true);
        window.dispatchEvent(new CustomEvent("agentpay:refresh"));
      }
    }).catch((err) => {
      if (active) { setLogs((p) => [...p, `[Error] ${err.message}`]); setDone(true); }
    });

    return () => { active = false; };
  }, [agent]);

  function classifyLine(line: string) {
    if (line.includes("✓")) return "text-[#00ff88]";
    if (line.includes("✗") || line.toLowerCase().includes("error")) return "text-[#ff4444]";
    if (line.includes("[Step")) return "text-[#ffd700] font-bold";
    if (line.includes("[Agent A] →")) return "text-[#4488ff]";
    if (line.includes("[Agent A] ←")) return "text-[#9945ff]";
    if (line.includes("[Done]") || line.includes("Completed")) return "text-[#00ff88] font-bold";
    if (line.startsWith("[AgentPay]")) return "text-gray-500 italic";
    return "text-gray-300";
  }

  return (
    <motion.div
      className="rounded-xl overflow-hidden mt-2"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      style={{ border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
        <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
        <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
        <span className="w-2 h-2 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[9px] font-mono flex-1" style={{ color: "var(--text-secondary)" }}>
          {agent.name} — {agent.service.replace(/_/g, " ")}
        </span>
        {!done && <span className="text-[9px] font-mono text-[#00ff88] animate-pulse">● LIVE</span>}
        {done && <span className="text-[9px] font-mono text-[#00ff88]">✓ DONE</span>}
        <button onClick={onClose} className="text-[9px] font-mono ml-2" style={{ color: "var(--text-secondary)" }}>✕</button>
      </div>
      <div className="p-3 text-xs font-mono overflow-y-auto" style={{ background: "#050505", height: 160, maxHeight: 160 }}>
        {logs.map((line, i) => (
          <div key={i} className={`leading-5 ${classifyLine(line)}`}>{line || " "}</div>
        ))}
        {!done && <span className="text-[#00ff88]">█</span>}
      </div>
    </motion.div>
  );
}

// Hardcoded seed — shown instantly on first render, replaced by API data
const SEED_AGENTS: Agent[] = [
  { id: "sol-audit",     name: "auditor-sol",          reputation: 0.95, chain: "solana-devnet",  service: "smart_contract_audit", priceUsd: 0.05,  txCount: 688,  tags: ["solidity", "audit", "EVM"] },
  { id: "sol-trust",     name: "trust-reporter-sol",   reputation: 0.92, chain: "solana-devnet",  service: "trust_report",         priceUsd: 0.005, txCount: 5814, tags: ["wallet", "risk", "on-chain"] },
  { id: "sol-sentiment", name: "sentiment-sol",        reputation: 0.93, chain: "solana-devnet",  service: "sentiment_analysis",   priceUsd: 0.005, txCount: 6203, tags: ["NLP", "analysis"] },
  { id: 9,               name: "auditor-fuji",         reputation: 0.94, chain: "avalanche-fuji", service: "smart_contract_audit", priceUsd: 0.10,  txCount: 521,  tags: ["solidity", "audit", "critical"] },
  { id: "sol-market",    name: "market-analyst-sol",   reputation: 0.88, chain: "solana-devnet",  service: "market_analysis",      priceUsd: 0.025, txCount: 1447, tags: ["DeFi", "trading", "crypto"] },
  { id: "sol-translate", name: "translator-sol",       reputation: 0.90, chain: "solana-devnet",  service: "translate",            priceUsd: 0.015, txCount: 1204, tags: ["i18n", "NLP"] },
];

export function AgentCards({ wsUrl = "ws://localhost:3001" }: { wsUrl?: string }) {
  const [agents, setAgents] = useState<Agent[]>(SEED_AGENTS); // Show immediately
  const [source, setSource] = useState("fallback");
  const [hiringAgent, setHiringAgent] = useState<Agent | null>(null);

  // Fetch real agents and replace seed data when ready
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const normalized = (data.agents ?? []).map(normalizeAgent);
        if (normalized.length > 0) {
          setAgents(normalized);
          setSource(data.source ?? "fallback");
        }
      })
      .catch((err) => console.error("[AgentCards] fetch failed:", err));
  }, []);

  // Mark recently active agents client-side based on WS events
  useEffect(() => {
    let ws: WebSocket;
    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (msg) => {
          try {
            const e = JSON.parse(msg.data);
            if (e.event === "job_completed" && e.agent_name) {
              setAgents((prev) => prev.map((a) =>
                a.name.includes(e.agent_name) || String(a.id).includes(e.agent_name)
                  ? { ...a, lastJobTimestamp: Date.now() / 1000, txCount: a.txCount + 1 }
                  : a
              ));
            }
            if (e.event === "reputation_updated" && e.agent_pubkey) {
              setAgents((prev) => prev.map((a) =>
                String(a.id) === e.agent_pubkey || a.pda === e.agent_pubkey
                  ? { ...a, reputation: (e.new_score ?? a.reputation * 1000) / 1000 }
                  : a
              ));
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => setTimeout(connect, 3000);
      } catch { setTimeout(connect, 5000); }
    }
    connect();
    return () => ws?.close();
  }, [wsUrl]);

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
          Agent Registry
        </p>
        {source && (
          <span className="text-[9px] font-mono" style={{ color: source.includes("anchor") ? "var(--accent-green)" : "var(--text-secondary)" }}>
            {source.includes("anchor") ? "● on-chain" : "● fallback"}
          </span>
        )}
      </div>

      {(
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {agents.map((a, i) => (
              <motion.div
                key={String(a.id)}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <AgentCard agent={a} onHire={setHiringAgent} />
              </motion.div>
            ))}
          </div>

          {hiringAgent && (
            <HireTerminal agent={hiringAgent} onClose={() => setHiringAgent(null)} />
          )}
        </>
      )}
    </div>
  );
}
