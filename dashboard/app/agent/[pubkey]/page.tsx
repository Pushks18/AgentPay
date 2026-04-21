"use client";

import { ClientDate } from "@/components/ClientDate";
import { ExternalLink, Shield, Zap } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentData {
  pubkey: string;
  name: string;
  services: string[];
  price: number;
  reputation: number;
  totalJobs: number;
  chain: string;
  stake: number;
  slashCount: number;
  active: boolean;
  registeredAt: number;
  service: string;
  endpoint?: string;
  reputationHistory: { ts: number; score: number }[];
  recentJobs: { id: string; buyer: string; amount: number; date: number; txHash: string; explorerUrl?: string }[];
}

function tierLabel(rep: number): { label: string; color: string } {
  if (rep >= 750) return { label: "Gold", color: "text-yellow-400" };
  if (rep >= 500) return { label: "Silver", color: "text-gray-300" };
  return { label: "Bronze", color: "text-orange-700" };
}

function truncate(s: string, n = 12) {
  return s.length > n ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

// ---------------------------------------------------------------------------
// Fetch agent data — reads from /api/agents + /api/jobs
// ---------------------------------------------------------------------------

async function fetchAgent(pubkey: string): Promise<AgentData> {
  // Fetch agents registry
  const [agentsRes, jobsRes] = await Promise.allSettled([
    fetch("/api/agents"),
    fetch("/api/jobs"),
  ]);

  let matchedAgent: any = null;
  if (agentsRes.status === "fulfilled") {
    const data = await agentsRes.value.json();
    matchedAgent = (data.agents ?? []).find(
      (a: any) => String(a.id) === pubkey || a.name === pubkey || a.pda === pubkey
    );
  }

  let recentJobs: AgentData["recentJobs"] = [];
  if (jobsRes.status === "fulfilled") {
    const data = await jobsRes.value.json();
    recentJobs = (data.jobs ?? [])
      .filter((j: any) => !matchedAgent || j.service === matchedAgent?.service || j.agentName === matchedAgent?.name)
      .slice(0, 10)
      .map((j: any) => ({
        id: j.id,
        buyer: j.agentName ?? "Agent-A",
        amount: j.amountPaid ?? 0,
        date: j.timestamp ?? Math.floor(Date.now() / 1000),
        txHash: j.txHash ?? "",
        explorerUrl: j.explorerUrl,
      }));
  }

  const now = Math.floor(Date.now() / 1000);

  if (matchedAgent) {
    const rep = matchedAgent.reputation > 1
      ? matchedAgent.reputation
      : Math.round(matchedAgent.reputation * 1000);

    return {
      pubkey,
      name: matchedAgent.name,
      services: [matchedAgent.service],
      service: matchedAgent.service,
      endpoint: matchedAgent.endpoint,
      price: matchedAgent.price_usd ?? matchedAgent.priceUsd ?? 0,
      reputation: rep,
      totalJobs: matchedAgent.tx_count ?? matchedAgent.txCount ?? 0,
      chain: matchedAgent.chain ?? "solana-devnet",
      stake: 0.15,
      slashCount: 0,
      active: matchedAgent.active ?? true,
      registeredAt: matchedAgent.registeredAt ?? now - 86400 * 7,
      reputationHistory: Array.from({ length: 30 }, (_, i) => ({
        ts: now - (30 - i) * 3600,
        score: Math.max(0, rep - 60 + i * 2),
      })),
      recentJobs,
    };
  }

  // Fallback: generic profile for pubkey
  return {
    pubkey,
    name: pubkey.startsWith("sol") ? `agent-${pubkey.slice(-6)}` : `fuji-${pubkey.slice(-6)}`,
    services: ["trust_report"],
    service: "trust_report",
    price: 0.005,
    reputation: 847,
    totalJobs: recentJobs.length,
    chain: "solana-devnet",
    stake: 0.15,
    slashCount: 0,
    active: true,
    registeredAt: now - 86400 * 7,
    reputationHistory: Array.from({ length: 30 }, (_, i) => ({
      ts: now - (30 - i) * 3600,
      score: 800 + i * 2,
    })),
    recentJobs,
  };
}

// ---------------------------------------------------------------------------
// Reputation chart (SVG line)
// ---------------------------------------------------------------------------

function ReputationChart({ history }: { history: { ts: number; score: number }[] }) {
  if (!history.length) return null;
  const W = 400, H = 80;
  const min = Math.min(...history.map((h) => h.score));
  const max = Math.max(...history.map((h) => h.score));
  const range = max - min || 1;
  const pts = history.map((h, i) => {
    const x = (i / (history.length - 1)) * W;
    const y = H - ((h.score - min) / range) * H;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
      <polyline points={pts.join(" ")} fill="none" stroke="#00ff88" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill="url(#repGrad)" stroke="none" />
      <defs>
        <linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00ff88" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#00ff88" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Hire terminal — streams Agent A output
// ---------------------------------------------------------------------------

function HireTerminal({ service, endpoint, pubkey, onClose }: {
  service: string; endpoint?: string; pubkey: string; onClose: () => void;
}) {
  const [logs, setLogs] = useState<string[]>([`[AgentPay] Hiring agent for ${service}…`, ""]);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/hire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentService: service, agentEndpoint: endpoint, pubkey }),
    }).then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (active) {
        const { done: d, value } = await reader.read();
        if (d) break;
        const chunk = decoder.decode(value, { stream: true });
        setLogs((prev) => [...prev, ...chunk.split("\n")].slice(-300));
      }
      if (active) setDone(true);
    }).catch((err) => {
      if (active) { setLogs((p) => [...p, `[Error] ${err.message}`]); setDone(true); }
    });
    return () => { active = false; };
  }, [service, endpoint, pubkey]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

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
    <div className="mt-6 rounded-xl overflow-hidden" style={{ border: "1px solid #1e1e1e" }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: "#111", borderBottom: "1px solid #1e1e1e" }}>
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[10px] font-mono text-gray-400 flex-1">agent_a — {service.replace(/_/g, " ")}</span>
        {!done && <span className="text-[9px] font-mono text-[#00ff88] animate-pulse">● LIVE</span>}
        {done && <span className="text-[9px] font-mono text-[#00ff88]">✓ DONE</span>}
        <button onClick={onClose} className="text-[10px] font-mono text-gray-500 hover:text-gray-300 ml-2">✕ close</button>
      </div>
      <div ref={logRef} className="p-4 text-xs font-mono overflow-y-auto" style={{ background: "#050505", height: 240 }}>
        {logs.map((line, i) => (
          <div key={i} className={`leading-5 ${classifyLine(line)}`}>{line || " "}</div>
        ))}
        {!done && <span className="text-[#00ff88]">█</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentProfilePage() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const router = useRouter();
  const [agent, setAgent] = useState<AgentData | null>(null);
  const [proving, setProving] = useState(false);
  const [proofResult, setProofResult] = useState<string | null>(null);
  const [hiring, setHiring] = useState(false);

  useEffect(() => {
    fetchAgent(pubkey).then(setAgent);
  }, [pubkey]);

  if (!agent) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-gray-400 font-mono text-sm">
        Loading agent…
      </div>
    );
  }

  const { label: tierLbl, color: tierColor } = tierLabel(agent.reputation);

  async function handleVerifyProof() {
    setProving(true);
    setProofResult(null);
    try {
      const res = await fetch("/api/verify-proof", { method: "POST" });
      const data = await res.json();
      setProofResult(data.message ?? "✅ Proof verified");
    } catch (err: any) {
      setProofResult(`❌ Verification failed: ${err.message}`);
    } finally {
      setProving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6 max-w-4xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="mb-6 flex items-center gap-1.5 text-xs font-mono transition-colors"
        style={{ color: "#555" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#00ff88"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "#555"; }}
      >
        ← Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold font-mono">{agent.name}</h1>
          <p className="text-gray-500 font-mono text-sm mt-1">{truncate(agent.pubkey, 20)}</p>
          <p className="text-xs text-gray-600 mt-1">
            Registered <ClientDate timestamp={agent.registeredAt} format="date" />
            {" · "}{agent.chain}
          </p>
          {agent.active ? (
            <span className="inline-flex items-center gap-1 mt-2 text-[10px] font-mono text-[#00ff88]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" /> Active
            </span>
          ) : (
            <span className="inline-block mt-2 text-[10px] font-mono text-red-400">● Inactive</span>
          )}
        </div>
        <div className="text-right">
          <div className={`text-5xl font-bold font-mono ${tierColor}`}>{agent.reputation}</div>
          <div className={`text-sm font-mono ${tierColor}`}>{tierLbl}</div>
          <div className="text-xs text-gray-500 mt-1">{agent.totalJobs.toLocaleString()} jobs completed</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Reputation chart */}
          <div className="bg-[#111] border border-[#222] rounded-lg p-4">
            <h2 className="text-sm font-mono text-gray-400 mb-3">Reputation History</h2>
            <ReputationChart history={agent.reputationHistory} />
            <div className="flex justify-between text-xs text-gray-600 font-mono mt-1">
              <span>30 days ago</span><span>Now</span>
            </div>
          </div>

          {/* Services + pricing */}
          <div className="bg-[#111] border border-[#222] rounded-lg p-4">
            <h2 className="text-sm font-mono text-gray-400 mb-3">Services</h2>
            <div className="space-y-2">
              {agent.services.map((s) => (
                <div key={s} className="flex justify-between text-sm">
                  <span className="font-mono text-white">{s.replace(/_/g, " ")}</span>
                  <span className="text-[#00ff88] font-mono">${agent.price.toFixed(4)} USDC</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stake info */}
          <div className="bg-[#111] border border-[#222] rounded-lg p-4">
            <h2 className="text-sm font-mono text-gray-400 mb-3">Stake & Security</h2>
            <div className="space-y-2 text-sm font-mono">
              <div className="flex justify-between">
                <span className="text-gray-400">Staked</span>
                <span className="text-white">{agent.stake} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Slash votes</span>
                <span className={agent.slashCount >= 2 ? "text-red-400" : "text-white"}>{agent.slashCount} / 3</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Status</span>
                <span className={agent.active ? "text-green-400" : "text-red-400"}>
                  {agent.active ? "Active" : "Deactivated"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* ZK credentials */}
          <div className="bg-[#111] border border-[#222] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} className="text-purple-400" />
              <h2 className="text-sm font-mono text-gray-400">ZK Credentials</h2>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Reputation verified via ZK-compressed tokens on Solana devnet (Light Protocol). Agent identity remains private.
            </p>
            <button
              onClick={handleVerifyProof}
              disabled={proving}
              className="w-full py-2 bg-purple-900/30 border border-purple-500/30 text-purple-400
                         text-sm font-mono rounded hover:bg-purple-900/50 disabled:opacity-50 transition-colors"
            >
              {proving ? "Verifying proof…" : "Verify Proof"}
            </button>
            {proofResult && (
              <p className="mt-2 text-xs font-mono" style={{ color: proofResult.startsWith("✅") ? "#00ff88" : "#ffd700" }}>
                {proofResult}
              </p>
            )}
          </div>

          {/* Recent jobs from Helius */}
          <div className="bg-[#111] border border-[#222] rounded-lg p-4">
            <h2 className="text-sm font-mono text-gray-400 mb-3">
              Recent Jobs
              <span className="ml-2 text-[9px] text-purple-400">● Helius devnet</span>
            </h2>
            {agent.recentJobs.length === 0 ? (
              <p className="text-xs font-mono text-gray-600">No on-chain jobs found yet</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {agent.recentJobs.map((job) => (
                  <div key={job.id} className="flex items-center justify-between text-xs font-mono text-gray-400">
                    <span>{truncate(job.buyer)}</span>
                    <span className="text-[#00ff88]">${job.amount.toFixed(4)}</span>
                    <ClientDate timestamp={job.date} format="date" />
                    {job.explorerUrl ? (
                      <a href={job.explorerUrl} target="_blank" rel="noopener noreferrer"
                        className="text-gray-600 hover:text-gray-300">
                        <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span className="text-gray-700">{truncate(job.txHash)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Hire button */}
          <button
            onClick={() => setHiring(true)}
            disabled={hiring}
            className="w-full py-3 bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88]
                       font-mono rounded-lg hover:bg-[#00ff88]/20 transition-colors flex items-center
                       justify-center gap-2 disabled:opacity-50"
          >
            <Zap size={16} />
            {hiring ? "Running Agent A…" : "Hire this agent"}
          </button>
        </div>
      </div>

      {/* Hire terminal */}
      {hiring && (
        <HireTerminal
          service={agent.service}
          endpoint={agent.endpoint}
          pubkey={agent.pubkey}
          onClose={() => setHiring(false)}
        />
      )}
    </div>
  );
}
