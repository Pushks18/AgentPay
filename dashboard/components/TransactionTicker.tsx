"use client";

import { useEffect, useRef, useState } from "react";

interface Tick {
  id: string;
  from: string;
  to: string;
  amount: number;
  chain: string;
  txHash?: string;
  fullTxHash?: string;
  secondsAgo: number;
  explorerUrl?: string;
}

// Shown instantly — replaced by real Helius data when it arrives
const SEED_TICKS: Tick[] = [
  { id: "s1", from: "Agent-A", to: "trust-reporter-sol",  amount: 0.005,  chain: "solana-devnet",  txHash: "4xK9…mN2p", secondsAgo: 12  },
  { id: "s2", from: "Agent-A", to: "auditor-fuji",         amount: 0.10,   chain: "avalanche-fuji", txHash: "0xab3c…d4e5",secondsAgo: 45  },
  { id: "s3", from: "Agent-B", to: "sentiment-sol",        amount: 0.005,  chain: "solana-devnet",  txHash: "7zT2…pQ8r",  secondsAgo: 120 },
  { id: "s4", from: "Agent-A", to: "market-analyst-sol",   amount: 0.025,  chain: "solana-devnet",  txHash: "9mK1…vX4q",  secondsAgo: 300 },
  { id: "s5", from: "Agent-C", to: "translator-fuji",      amount: 0.03,   chain: "avalanche-fuji", txHash: "0xfe12…ab89",secondsAgo: 420 },
];

export function TransactionTicker({ wsUrl = "ws://localhost:3001" }: { wsUrl?: string }) {
  const [ticks, setTicks] = useState<Tick[]>(SEED_TICKS); // Shown immediately
  const fetchedRef = useRef(false);

  // Initial fetch of real transactions from Helius
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    fetch("/api/transactions")
      .then((r) => r.json())
      .then((data) => {
        const real: Tick[] = (data.transactions ?? []).map((t: any) => ({
          id: t.id,
          from: t.from ?? "Agent-A",
          to: t.to ?? "agent-b",
          amount: t.amount ?? 0,
          chain: t.chain ?? "solana-devnet",
          txHash: t.txHash,
          fullTxHash: t.fullTxHash,
          secondsAgo: t.secondsAgo ?? 0,
          explorerUrl: t.explorerUrl,
        }));
        if (real.length > 0) setTicks(real);
      })
      .catch(() => {});

    // Poll for new transactions every 15s
    const pollId = setInterval(() => {
      fetch("/api/transactions")
        .then((r) => r.json())
        .then((data) => {
          const real: Tick[] = (data.transactions ?? []).map((t: any) => ({
            id: t.id,
            from: t.from ?? "Agent-A",
            to: t.to ?? "agent-b",
            amount: t.amount ?? 0,
            chain: t.chain ?? "solana-devnet",
            txHash: t.txHash,
            fullTxHash: t.fullTxHash,
            secondsAgo: t.secondsAgo ?? 0,
            explorerUrl: t.explorerUrl,
          }));
          if (real.length > 0) {
            setTicks((prev) => {
              // Add any genuinely new signatures
              const existing = new Set(prev.map((t) => t.id));
              const newOnes = real.filter((t) => !existing.has(t.id));
              return newOnes.length > 0 ? [...newOnes, ...prev].slice(0, 24) : prev;
            });
          }
        })
        .catch(() => {});
    }, 15000);

    return () => clearInterval(pollId);
  }, []);

  // WebSocket for instant new transactions
  useEffect(() => {
    let ws: WebSocket;
    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (msg) => {
          try {
            const e = JSON.parse(msg.data);
            if (e.event === "payment_initiated" || e.event === "job_completed") {
              const newTick: Tick = {
                id: String(Date.now()),
                from: e.from || "Agent-A",
                to: e.to || e.agent_name || "Agent-B",
                amount: e.amount || e.total_paid || 0,
                chain: e.chain === "solana-devnet" ? "solana-devnet" : "avalanche-fuji",
                txHash: e.tx_hash ? e.tx_hash.slice(0, 8) + "…" + e.tx_hash.slice(-4) : undefined,
                fullTxHash: e.tx_hash,
                secondsAgo: 1,
                explorerUrl: e.explorer_url,
              };
              setTicks((prev) => [newTick, ...prev].slice(0, 24));
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

  // Increment secondsAgo every second
  useEffect(() => {
    const id = setInterval(() => {
      setTicks((prev) => prev.map((t) => ({ ...t, secondsAgo: t.secondsAgo + 1 })));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Duplicate for seamless loop when few items
  const items = ticks.length > 0 ? [...ticks, ...ticks] : [];

  return (
    <div
      className="w-full overflow-hidden flex items-center"
      style={{
        height: 32,
        background: "var(--bg-card)",
        borderBottom: "1px solid var(--border)",
        borderLeft: "3px solid var(--accent-green)",
      }}
    >
      {/* LIVE label */}
      <div
        className="flex-shrink-0 flex items-center gap-1.5 px-3 text-[10px] font-mono h-full"
        style={{
          color: "var(--accent-green)",
          borderRight: "1px solid var(--border)",
          background: "rgba(0,255,136,0.04)",
        }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
        LIVE
      </div>

      {/* Scrolling content */}
      <div className="flex-1 overflow-hidden">
        {(
          <div
            className="flex gap-8 whitespace-nowrap"
            style={{ animation: "ticker-scroll 50s linear infinite" }}
          >
            {items.map((t, i) => {
              const isSol = t.chain === "solana-devnet";
              return (
                <span key={`${t.id}-${i}`} className="flex-shrink-0 flex items-center gap-1.5 text-[11px] font-mono">
                  <span className="text-white">{t.from}</span>
                  <span style={{ color: "var(--text-secondary)" }}>→</span>
                  <span className="text-white">{t.to}</span>
                  <span style={{ color: "var(--text-secondary)" }}>·</span>
                  <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>
                    {t.amount.toFixed(4)} USDC
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>·</span>
                  <span style={{ color: "var(--text-secondary)" }}>✓</span>
                  <span style={{ color: isSol ? "#9945ff" : "#e84142" }}>
                    {isSol ? "Solana" : "Fuji"}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>·</span>
                  <span style={{ color: "var(--text-secondary)" }}>{t.secondsAgo}s</span>
                  {t.txHash && t.explorerUrl ? (
                    <>
                      <span style={{ color: "var(--border)" }}>·</span>
                      <a
                        href={t.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        style={{ color: "#555" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t.txHash}
                      </a>
                    </>
                  ) : t.txHash ? (
                    <>
                      <span style={{ color: "var(--border)" }}>·</span>
                      <span style={{ color: "#555" }}>{t.txHash}</span>
                    </>
                  ) : null}
                  <span style={{ color: "#333", marginLeft: 16 }}>⬥</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
