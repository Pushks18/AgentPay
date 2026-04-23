import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELIUS_KEY  = process.env.HELIUS_API_KEY ?? "9ce8eb88-acf3-4c18-881b-bca557bee300";
const AGENT_B_SOL = process.env.AGENT_B_SOL_ADDRESS ?? "8XFrS35Ch1tqzmAXZ4n4YBjAwSFgUZbwbqpKFWzyevYe";
const RPC_URL     = `https://devnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
const USDC_DEVNET = process.env.USDC_DEVNET ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// Shown immediately while Helius loads
const MOCK_TICKS = [
  { id: "m1", from: "Agent-A", to: "trust-reporter-sol",  amount: 0.005, chain: "solana-devnet",  txHash: "4xK9…mN2p", secondsAgo: 12  },
  { id: "m2", from: "Agent-A", to: "auditor-fuji",         amount: 0.10,  chain: "avalanche-fuji", txHash: "0xab3c…d4e5", secondsAgo: 45  },
  { id: "m3", from: "Agent-B", to: "sentiment-sol",        amount: 0.005, chain: "solana-devnet",  txHash: "7zT2…pQ8r", secondsAgo: 120 },
  { id: "m4", from: "Agent-A", to: "market-analyst-sol",   amount: 0.025, chain: "solana-devnet",  txHash: "9mK1…vX4q", secondsAgo: 300 },
  { id: "m5", from: "Agent-C", to: "translator-fuji",      amount: 0.03,  chain: "avalanche-fuji", txHash: "0xfe12…ab89", secondsAgo: 420 },
];

async function rpc(method: string, params: any[], timeoutMs = 5000) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

const SERVICE_MAP: Record<string, { name: string; price: number }> = {
  trust_report:         { name: "trust-reporter-sol", price: 0.005 },
  code_review:          { name: "code-reviewer-sol", price: 0.025 },
  summarize:            { name: "summarizer-sol", price: 0.01 },
  sql_generator:        { name: "sql-gen-sol", price: 0.015 },
  translate:            { name: "translator-sol", price: 0.015 },
  code_explain:         { name: "code-explainer-sol", price: 0.01 },
  regex_generator:      { name: "regex-gen-sol", price: 0.015 },
  sentiment_analysis:   { name: "sentiment-sol", price: 0.005 },
  smart_contract_audit: { name: "auditor-sol", price: 0.05 },
  market_analysis:      { name: "market-analyst-sol", price: 0.025 },
  payment:              { name: "trust-reporter-sol", price: 0.005 },
};

function inferService(tx: any): string {
  const logs: string[] = tx?.meta?.logMessages ?? [];
  const combined = logs.join(" ").toLowerCase();
  if (combined.includes("audit")) return "smart_contract_audit";
  if (combined.includes("trust")) return "trust_report";
  if (combined.includes("sentiment")) return "sentiment_analysis";
  if (combined.includes("market")) return "market_analysis";
  if (combined.includes("translate")) return "translate";
  if (combined.includes("summarize") || combined.includes("summary")) return "summarize";
  if (combined.includes("sql")) return "sql_generator";
  if (combined.includes("regex")) return "regex_generator";
  if (combined.includes("explain")) return "code_explain";
  if (combined.includes("review")) return "code_review";
  return "payment";
}

function parseUsdcAmount(tx: any): number {
  const pre: any[] = tx?.meta?.preTokenBalances ?? [];
  const post: any[] = tx?.meta?.postTokenBalances ?? [];
  for (const p of post) {
    if (p.mint !== USDC_DEVNET) continue;
    const before = pre.find((x: any) => x.accountIndex === p.accountIndex && x.mint === USDC_DEVNET);
    const delta = Math.abs(Number(p.uiTokenAmount?.uiAmount ?? 0) - Number(before?.uiTokenAmount?.uiAmount ?? 0));
    if (delta > 0) return delta;
  }
  return 0;
}

function getSender(tx: any): string {
  try {
    const keys: any[] = tx?.transaction?.message?.accountKeys ?? [];
    const first = keys[0];
    const pk = typeof first === "string" ? first : first?.pubkey ?? "";
    return pk ? pk.slice(0, 6) + "…" + pk.slice(-4) : "Agent-A";
  } catch { return "Agent-A"; }
}

export async function GET() {
  const now = Math.floor(Date.now() / 1000);

  try {
    let sigs: any[] = [];
    try {
      sigs = await rpc("getSignaturesForAddress", [AGENT_B_SOL, { limit: 12, commitment: "confirmed" }]);
      if (!Array.isArray(sigs)) sigs = [];
    } catch (err) {
      console.error("[/api/transactions] getSignaturesForAddress failed:", err);
    }

    if (sigs.length === 0) {
      return NextResponse.json({ transactions: MOCK_TICKS, source: "mock-no-txns" });
    }

    // Fetch transactions, allow partial failures
    const txResults = await Promise.allSettled(
      sigs.slice(0, 10).map((s: any) =>
        rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }], 4000)
      )
    );

    const transactions: any[] = [];
    for (let i = 0; i < txResults.length; i++) {
      const result = txResults[i];
      if (result.status !== "fulfilled" || !result.value) continue;
      const tx = result.value;
      const sig = sigs[i];
      if (tx?.meta?.err) continue;

      const service = inferService(tx);
      const mapped = SERVICE_MAP[service] ?? SERVICE_MAP.payment;
      const parsedAmount = parseUsdcAmount(tx);
      // Never emit zero: fallback to known service price for demo clarity.
      const amount = parsedAmount > 0 ? parsedAmount : mapped.price;
      transactions.push({
        id: sig.signature,
        from: "agent-a",
        to: mapped.name,
        amount,
        chain: "solana-devnet",
        service,
        txHash: sig.signature.slice(0, 8) + "…" + sig.signature.slice(-4),
        fullTxHash: sig.signature,
        secondsAgo: sig.blockTime ? now - sig.blockTime : 0,
        explorerUrl: `https://explorer.solana.com/tx/${sig.signature}?cluster=devnet`,
      });
    }

    if (transactions.length === 0) {
      return NextResponse.json({ transactions: MOCK_TICKS, source: "mock-non-usdc" });
    }

    return NextResponse.json({ transactions, source: "helius", address: AGENT_B_SOL });
  } catch (err) {
    console.error("[/api/transactions] Unexpected error:", err);
    return NextResponse.json({ transactions: MOCK_TICKS, source: "mock-error" });
  }
}
