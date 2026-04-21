"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClientDate } from "@/components/ClientDate";

type JobStatus = "Searching" | "Negotiating" | "Escrow Locked" | "Completed" | "Disputed";

interface Job {
  id: string;
  agentName: string;
  service: string;
  amountPaid: number;
  durationMs: number;
  status: JobStatus;
  txHash?: string;
  explorerUrl?: string;
  chain: "avalanche-fuji" | "solana-devnet";
  reasoningTrace?: string;
  zkProofUrl?: string;
  timestamp: number;
}

const STATUS_COLORS: Record<JobStatus, { bg: string; text: string; border: string }> = {
  Searching:       { bg: "rgba(68,136,255,0.12)", text: "#4488ff", border: "rgba(68,136,255,0.3)" },
  Negotiating:     { bg: "rgba(255,215,0,0.12)",  text: "#ffd700", border: "rgba(255,215,0,0.3)" },
  "Escrow Locked": { bg: "rgba(255,136,0,0.12)",  text: "#ff8800", border: "rgba(255,136,0,0.3)" },
  Completed:       { bg: "rgba(0,255,136,0.12)",  text: "#00ff88", border: "rgba(0,255,136,0.3)" },
  Disputed:        { bg: "rgba(255,68,68,0.12)",  text: "#ff4444", border: "rgba(255,68,68,0.3)" },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const c = STATUS_COLORS[status];
  return (
    <span className="text-[10px] px-2 py-0.5 rounded font-mono"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {status}
    </span>
  );
}

function JobCard({ job }: { job: Job }) {
  const [expanded, setExpanded] = useState(false);
  const isSol = job.chain === "solana-devnet";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className={`rounded-lg p-3 cursor-pointer ${isSol ? "chain-sol" : "chain-avax"}`}
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeftWidth: 3 }}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{job.agentName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
              {job.service.replace(/_/g, " ")}
            </span>
            <StatusBadge status={job.status} />
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono flex-wrap"
            style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: isSol ? "#9945ff" : "#e84142" }}>
              {isSol ? "Solana" : "Fuji"}
            </span>
            <span className="text-white">${job.amountPaid.toFixed(4)}</span>
            {job.durationMs > 0 && <span>{(job.durationMs / 1000).toFixed(1)}s</span>}
            <ClientDate timestamp={job.timestamp} format="time" />
          </div>
        </div>
        {job.explorerUrl && (
          <a
            href={job.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 transition-colors"
            style={{ color: "var(--accent-green)" }}
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-2 space-y-1.5 overflow-hidden"
          >
            {job.txHash && (
              <div className="text-[10px] font-mono break-all" style={{ color: "var(--text-secondary)" }}>
                TX: {job.txHash}
              </div>
            )}
            {job.reasoningTrace && (
              <div className="text-[10px] font-mono p-2 rounded whitespace-pre-wrap max-h-32 overflow-y-auto"
                style={{ background: "#050505", color: "var(--text-secondary)" }}>
                {job.reasoningTrace}
              </div>
            )}
            {job.zkProofUrl && (
              <a href={job.zkProofUrl} target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-mono flex items-center gap-1 hover:underline"
                style={{ color: "#9945ff" }}>
                ZK Proof on Explorer <ExternalLink size={9} />
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TotalsBar({ jobs }: { jobs: Job[] }) {
  const today = jobs.filter((j) => j.timestamp > Date.now() / 1000 - 86400);
  const totalUsdc = today.filter((j) => j.status === "Completed").reduce((s, j) => s + j.amountPaid, 0);
  const avgMs = today.filter((j) => j.durationMs > 0).reduce((s, j) => s + j.durationMs, 0) /
    (today.filter((j) => j.durationMs > 0).length || 1);

  return (
    <div className="flex gap-4 text-[10px] font-mono pb-2 mb-2 flex-wrap"
      style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
      <span>Jobs: <span className="text-white">{today.length}</span></span>
      <span>Settled: <span style={{ color: "var(--accent-green)" }}>${totalUsdc.toFixed(4)}</span></span>
      {avgMs > 0 && <span>Avg: <span className="text-white">{(avgMs / 1000).toFixed(1)}s</span></span>}
    </div>
  );
}

// Seed jobs — timestamps set to 0 and stamped client-side in useEffect
const SEED_JOBS: Job[] = [
  { id: "seed-1", agentName: "trust-reporter-sol", service: "trust_report",         amountPaid: 0.005, durationMs: 28400, status: "Completed", chain: "solana-devnet",  txHash: "4xK9…mN2p", timestamp: 0 },
  { id: "seed-2", agentName: "auditor-fuji",        service: "smart_contract_audit", amountPaid: 0.10,  durationMs: 42100, status: "Completed", chain: "avalanche-fuji", txHash: "0xab3c…d4e5", timestamp: 0 },
  { id: "seed-3", agentName: "sentiment-sol",       service: "sentiment_analysis",   amountPaid: 0.005, durationMs: 5200,  status: "Completed", chain: "solana-devnet",  txHash: "7mP2…qR8s", timestamp: 0 },
];

export function JobFeed({ wsUrl = "ws://localhost:3001" }: { wsUrl?: string }) {
  const [jobs, setJobs] = useState<Job[]>([]); // Start empty — seeded client-side
  const fetchedRef = useRef(false);

  // Stamp seed jobs with real timestamps client-side (avoids SSR mismatch)
  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    setJobs(SEED_JOBS.map((j, i) => ({ ...j, timestamp: now - (i + 1) * 300 })));
  }, []);

  // Fetch real jobs from Helius and replace seed data
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    fetch("/api/jobs")
      .then((r) => r.json())
      .then((data) => {
        const real: Job[] = (data.jobs ?? []).map((j: any) => ({
          id: j.id,
          agentName: j.agentName ?? "agent-b",
          service: j.service ?? "unknown",
          amountPaid: j.amountPaid ?? 0,
          durationMs: j.durationMs ?? 0,
          status: (j.status ?? "Completed") as JobStatus,
          txHash: j.txHash,
          explorerUrl: j.explorerUrl,
          chain: (j.chain ?? "solana-devnet") as Job["chain"],
          timestamp: j.timestamp ?? Math.floor(Date.now() / 1000),
        }));
        if (real.length > 0) setJobs(real);
      })
      .catch((err) => console.error("[JobFeed] fetch failed:", err));
  }, []);

  // WebSocket for live updates
  useEffect(() => {
    let ws: WebSocket;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (msg) => {
          try {
            const event = JSON.parse(msg.data);
            if (event.event === "job_completed") {
              const newJob: Job = {
                id: event.job_id || String(Date.now()),
                agentName: event.agent_name || "unknown",
                service: event.service || "unknown",
                amountPaid: event.total_paid || 0,
                durationMs: event.duration_ms || 0,
                status: "Completed",
                txHash: event.tx_hash,
                explorerUrl: event.explorer_url,
                chain: (event.chain || "solana-devnet") as Job["chain"],
                timestamp: event.timestamp || Math.floor(Date.now() / 1000),
              };
              setJobs((prev) => [newJob, ...prev].slice(0, 30));
            } else if (event.event === "payment_initiated") {
              setJobs((prev) => {
                const existing = prev.find((j) => j.id === event.job_id);
                if (existing) {
                  return prev.map((j) => j.id === event.job_id ? { ...j, status: "Escrow Locked" as JobStatus } : j);
                }
                const initiated: Job = {
                  id: event.job_id || String(Date.now()),
                  agentName: event.to || "agent-b",
                  service: "unknown",
                  amountPaid: event.amount || 0,
                  durationMs: 0,
                  status: "Escrow Locked",
                  chain: (event.chain || "solana-devnet") as Job["chain"],
                  timestamp: Math.floor(Date.now() / 1000),
                };
                return [initiated, ...prev].slice(0, 30);
              });
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => { retryTimeout = setTimeout(connect, 3000); };
      } catch { retryTimeout = setTimeout(connect, 5000); }
    }
    connect();
    return () => { ws?.close(); clearTimeout(retryTimeout); };
  }, [wsUrl]);

  return (
    <div className="flex flex-col gap-2">
      <TotalsBar jobs={jobs} />
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {jobs.map((job) => <JobCard key={job.id} job={job} />)}
        </AnimatePresence>
      </div>
    </div>
  );
}
