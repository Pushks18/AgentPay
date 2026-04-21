"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

interface LivePayment {
  id: string;
  from: string;
  to: string;
  amount: number;
  chain: string;
  txHash?: string;
}

export function PaymentPulse({ wsUrl = "ws://localhost:3001" }: { wsUrl?: string }) {
  const [payment, setPayment] = useState<LivePayment | null>(null);

  useEffect(() => {
    let ws: WebSocket;
    let dismissTimer: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (msg) => {
          try {
            const e = JSON.parse(msg.data);
            if (e.event === "payment_initiated" || e.event === "job_completed") {
              clearTimeout(dismissTimer);
              const chainLabel =
                e.chain === "solana-devnet" ? "Solana Devnet" :
                e.chain === "avalanche-fuji" ? "Avalanche Fuji" :
                e.chain || "On-Chain";
              setPayment({
                id: e.job_id || String(Date.now()),
                from: e.from || "Agent A",
                to: e.to || e.agent_name || "Agent B",
                amount: e.amount || e.total_paid || 0,
                chain: chainLabel,
                txHash: e.tx_hash,
              });
              dismissTimer = setTimeout(() => setPayment(null), 4000);
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => setTimeout(connect, 3000);
      } catch { setTimeout(connect, 5000); }
    }

    connect();
    return () => {
      ws?.close();
      clearTimeout(dismissTimer);
    };
  }, [wsUrl]);

  return (
    <AnimatePresence>
      {payment && (
        <motion.div
          key={payment.id}
          initial={{ y: -64, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -64, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-50 bg-[#00ff88] text-black py-2.5 px-6 flex items-center justify-center gap-3 font-mono text-sm font-bold shadow-[0_4px_24px_rgba(0,255,136,0.4)]"
        >
          <span>⚡ LIVE PAYMENT</span>
          <span className="font-normal opacity-70">·</span>
          <span>{payment.from}</span>
          <span className="font-normal">→</span>
          <span>{payment.to}</span>
          <span className="font-normal opacity-70">·</span>
          <span>{payment.amount.toFixed(4)} USDC</span>
          <span className="font-normal opacity-70">·</span>
          <span className="font-normal">{payment.chain}</span>
          {payment.txHash && (
            <>
              <span className="font-normal opacity-70">·</span>
              <span className="font-normal opacity-60 text-xs">{payment.txHash.slice(0, 12)}…</span>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
