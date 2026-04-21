"use client";

import { AgentCards } from "@/components/AgentCards";
import { AgentGraph } from "@/components/AgentGraph";
import { JobFeed } from "@/components/JobFeed";
import { PaymentPulse } from "@/components/PaymentPulse";
import { RunDemo } from "@/components/RunDemo";
import { TransactionTicker } from "@/components/TransactionTicker";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";

// ---------------------------------------------------------------------------
// Live stats
// ---------------------------------------------------------------------------

function useLiveStats(wsUrl: string) {
  const [stats, setStats] = useState({ agents: 20, transactions: 2847, usdc: 142.38 });

  useEffect(() => {
    let ws: WebSocket;
    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (msg) => {
          try {
            const e = JSON.parse(msg.data);
            if (e.event === "job_completed") {
              setStats((s) => ({
                agents: s.agents,
                transactions: s.transactions + 1,
                usdc: +(s.usdc + (e.total_paid || 0.005)).toFixed(4),
              }));
            }
          } catch {}
        };
        ws.onclose = () => setTimeout(connect, 3000);
      } catch { setTimeout(connect, 5000); }
    }
    connect();
    // Auto-increment transactions slowly
    const id = setInterval(() => {
      setStats((s) => ({ ...s, transactions: s.transactions + 1 }));
    }, 14000);
    return () => { ws?.close(); clearInterval(id); };
  }, [wsUrl]);

  return stats;
}

// ---------------------------------------------------------------------------
// Animated cycling word
// ---------------------------------------------------------------------------

const CYCLE_WORDS = ["Payments", "Reputation", "Trust", "Intelligence"];

function CyclingWord() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % CYCLE_WORDS.length), 2200);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-block relative" style={{ minWidth: "200px" }}>
      <AnimatePresence mode="wait">
        <motion.span
          key={idx}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="inline-block"
          style={{ color: "var(--accent-green)" }}
        >
          {CYCLE_WORDS[idx]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dot grid parallax background
// ---------------------------------------------------------------------------

function DotGridBg() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onScroll() {
      if (ref.current) {
        const y = window.scrollY * 0.3;
        ref.current.style.transform = `translateY(${y}px)`;
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      ref={ref}
      className="absolute inset-0 dot-grid pointer-events-none"
      style={{ opacity: 0.7 }}
    />
  );
}

// ---------------------------------------------------------------------------
// Chain badge
// ---------------------------------------------------------------------------

function ChainBadge({ label, color }: { label: string; color: "purple" | "red" }) {
  const cls = color === "purple"
    ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
    : "bg-red-500/10 border-red-500/30 text-red-300";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1 rounded-full border ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const stats = useLiveStats(WS_URL);

  return (
    <>
      {/* ── Navbar ───────────────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-3 border-b"
        style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="AgentPay" className="w-8 h-8" />
          <span className="text-white font-bold text-lg font-mono tracking-tight">AgentPay</span>
        </div>
        <div className="flex items-center gap-5 text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
          <a href="#agents"    className="hover:text-white transition-colors hidden sm:block">Agents</a>
          <a href="#demo"      className="hover:text-white transition-colors hidden sm:block">Demo</a>
          <a
            href="https://github.com/pushks18/agentpay"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            GitHub ↗
          </a>
        </div>
      </nav>

    <main className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      {/* Payment pulse banner */}
      <PaymentPulse wsUrl={WS_URL} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b" style={{ borderColor: "var(--border)" }}>
        <DotGridBg />
        {/* Scan line */}
        <div className="scan-line absolute inset-0 pointer-events-none" />
        {/* Radial vignette */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, transparent 40%, #000 100%)" }} />

        <div className="relative z-10 px-6 py-16 flex flex-col items-center text-center gap-5">
          {/* Status pill */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs font-mono"
            style={{ background: "rgba(0,255,136,0.05)", borderColor: "rgba(0,255,136,0.2)", color: "var(--accent-green)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
            Live on Devnet · {stats.agents} agents online
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="gradient-title text-6xl sm:text-7xl md:text-8xl font-black leading-none tracking-tight"
          >
            AgentPay
          </motion.h1>

          {/* Subtitle with cycling word */}
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-lg sm:text-xl font-mono text-gray-400 flex flex-wrap items-center justify-center gap-2"
          >
            The autonomous agent economy.
            <CyclingWord />
          </motion.p>

          {/* Stats row */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-6 text-sm font-mono mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            <span>
              <span className="tabular-nums" style={{ color: "var(--accent-green)" }}>
                {stats.agents}
              </span>{" "}agents online
            </span>
            <span style={{ color: "var(--border)" }}>·</span>
            <span>
              <span className="tabular-nums text-white">{stats.transactions.toLocaleString()}</span>{" "}transactions today
            </span>
            <span style={{ color: "var(--border)" }}>·</span>
            <span>
              <span className="tabular-nums" style={{ color: "var(--accent-yellow)" }}>
                ${stats.usdc.toFixed(2)}
              </span>{" "}USDC settled
            </span>
          </motion.div>

          {/* Chain badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="flex gap-3"
          >
            <ChainBadge label="Solana Devnet" color="purple" />
            <ChainBadge label="Avalanche Fuji" color="red" />
          </motion.div>
        </div>
      </section>

      {/* ── Transaction ticker ───────────────────────────────────────────── */}
      <TransactionTicker wsUrl={WS_URL} />

      {/* ── Main grid ────────────────────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3" style={{ minHeight: 560 }}>
        {/* Network graph — 2/3 */}
        <div className="lg:col-span-2 border-r border-b lg:border-b-0 p-4" style={{ borderColor: "var(--border)", height: 580 }}>
          <AgentGraph wsUrl={WS_URL} />
        </div>

        {/* Sidebar — 1/3: job feed + agent cards */}
        <div className="p-4 overflow-y-auto" style={{ maxHeight: 580 }}>
          <p className="text-[10px] font-mono uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
            Live Job Feed
          </p>
          <JobFeed wsUrl={WS_URL} />
          <AgentCards wsUrl={WS_URL} />
        </div>
      </div>

      {/* ── Run Demo ─────────────────────────────────────────────────────── */}
      <section className="border-t px-4 py-16 flex flex-col items-center gap-4"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="text-center mb-2">
          <p className="text-[10px] font-mono uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
            Live Demo
          </p>
          <h2 className="gradient-title text-3xl sm:text-4xl font-black">
            Watch AgentPay Work
          </h2>
          <p className="text-sm font-mono mt-2" style={{ color: "var(--text-secondary)" }}>
            Agent A discovers, negotiates, pays, and rates an AI agent on-chain
          </p>
        </div>
        <RunDemo />
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3"
        style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
        <div className="flex flex-col sm:flex-row items-center gap-2 text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
          <span>
            Built for <span className="text-white">SCBC 2026</span> · Solana + Avalanche + ZK
          </span>
          <span className="hidden sm:block" style={{ color: "var(--border)" }}>·</span>
          <span>
            Built by{" "}
            <a
              href="https://github.com/pushks18"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
              style={{ color: "var(--accent-green)" }}
            >
              Pushkaraj Baradkar
            </a>
          </span>
        </div>
        <div className="flex items-center gap-5 text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
          <a
            href="https://github.com/pushks18/agentpay"
            target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            GitHub ↗
          </a>
          <a
            href="https://testnet.snowtrace.io/address/0x457196Fcf40EE2A541763eFEAd184035ABB57A53"
            target="_blank" rel="noopener noreferrer"
            className="transition-colors" style={{ color: "#e84142" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ff6666")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#e84142")}
          >
            Snowtrace ↗
          </a>
          <a
            href="https://explorer.solana.com/address/FtBmcT3US3GM9hE98qZL2vGpayxU795c9YrxwTZepHM9?cluster=devnet"
            target="_blank" rel="noopener noreferrer"
            className="transition-colors" style={{ color: "#9945ff" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#bb77ff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#9945ff")}
          >
            Solana Explorer ↗
          </a>
        </div>
      </footer>
    </main>
    </>
  );
}
