import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_B_FUJI = process.env.AGENT_B_FUJI_URL ?? "http://localhost:8001";
const AGENT_B_SOL  = process.env.AGENT_B_SOL_URL  ?? "http://localhost:8002";

// Always-available fallback — mirrors agent_a/tools/registry.py FALLBACK_REGISTRY
const FALLBACK_REGISTRY = [
  { id: 1,              name: "trust-reporter-fuji",  service: "trust_report",         chain: "avalanche-fuji", price_usd: 0.01,  reputation: 0.91, tx_count: 3241, active: true, endpoint: `${AGENT_B_FUJI}/trust-report` },
  { id: 2,              name: "code-reviewer-fuji",   service: "code_review",          chain: "avalanche-fuji", price_usd: 0.05,  reputation: 0.88, tx_count: 1872, active: true, endpoint: `${AGENT_B_FUJI}/code-review` },
  { id: 3,              name: "summarizer-fuji",      service: "summarize",            chain: "avalanche-fuji", price_usd: 0.02,  reputation: 0.90, tx_count: 2109, active: true, endpoint: `${AGENT_B_FUJI}/summarize` },
  { id: 4,              name: "sql-gen-fuji",         service: "sql_generator",        chain: "avalanche-fuji", price_usd: 0.03,  reputation: 0.87, tx_count: 1456, active: true, endpoint: `${AGENT_B_FUJI}/sql-generator` },
  { id: 5,              name: "translator-fuji",      service: "translate",            chain: "avalanche-fuji", price_usd: 0.03,  reputation: 0.89, tx_count: 987,  active: true, endpoint: `${AGENT_B_FUJI}/translate` },
  { id: 6,              name: "code-explainer-fuji",  service: "code_explain",         chain: "avalanche-fuji", price_usd: 0.02,  reputation: 0.86, tx_count: 743,  active: true, endpoint: `${AGENT_B_FUJI}/code-explain` },
  { id: 7,              name: "regex-gen-fuji",       service: "regex_generator",      chain: "avalanche-fuji", price_usd: 0.03,  reputation: 0.85, tx_count: 612,  active: true, endpoint: `${AGENT_B_FUJI}/regex-generator` },
  { id: 8,              name: "sentiment-fuji",       service: "sentiment_analysis",   chain: "avalanche-fuji", price_usd: 0.01,  reputation: 0.92, tx_count: 4102, active: true, endpoint: `${AGENT_B_FUJI}/sentiment-analysis` },
  { id: 9,              name: "auditor-fuji",         service: "smart_contract_audit", chain: "avalanche-fuji", price_usd: 0.10,  reputation: 0.94, tx_count: 521,  active: true, endpoint: `${AGENT_B_FUJI}/smart-contract-audit` },
  { id: 10,             name: "market-analyst-fuji",  service: "market_analysis",      chain: "avalanche-fuji", price_usd: 0.05,  reputation: 0.87, tx_count: 1033, active: true, endpoint: `${AGENT_B_FUJI}/market-analysis` },
  { id: "sol-trust",    name: "trust-reporter-sol",   service: "trust_report",         chain: "solana-devnet",  price_usd: 0.005, reputation: 0.92, tx_count: 5814, active: true, endpoint: `${AGENT_B_SOL}/trust-report` },
  { id: "sol-code",     name: "code-reviewer-sol",    service: "code_review",          chain: "solana-devnet",  price_usd: 0.025, reputation: 0.89, tx_count: 2341, active: true, endpoint: `${AGENT_B_SOL}/code-review` },
  { id: "sol-summarize",name: "summarizer-sol",       service: "summarize",            chain: "solana-devnet",  price_usd: 0.01,  reputation: 0.91, tx_count: 3076, active: true, endpoint: `${AGENT_B_SOL}/summarize` },
  { id: "sol-sql",      name: "sql-gen-sol",          service: "sql_generator",        chain: "solana-devnet",  price_usd: 0.015, reputation: 0.88, tx_count: 1887, active: true, endpoint: `${AGENT_B_SOL}/sql-generator` },
  { id: "sol-translate",name: "translator-sol",       service: "translate",            chain: "solana-devnet",  price_usd: 0.015, reputation: 0.90, tx_count: 1204, active: true, endpoint: `${AGENT_B_SOL}/translate` },
  { id: "sol-explain",  name: "code-explainer-sol",   service: "code_explain",         chain: "solana-devnet",  price_usd: 0.01,  reputation: 0.87, tx_count: 894,  active: true, endpoint: `${AGENT_B_SOL}/code-explain` },
  { id: "sol-regex",    name: "regex-gen-sol",        service: "regex_generator",      chain: "solana-devnet",  price_usd: 0.015, reputation: 0.86, tx_count: 731,  active: true, endpoint: `${AGENT_B_SOL}/regex-generator` },
  { id: "sol-sentiment",name: "sentiment-sol",        service: "sentiment_analysis",   chain: "solana-devnet",  price_usd: 0.005, reputation: 0.93, tx_count: 6203, active: true, endpoint: `${AGENT_B_SOL}/sentiment-analysis` },
  { id: "sol-audit",    name: "auditor-sol",          service: "smart_contract_audit", chain: "solana-devnet",  price_usd: 0.05,  reputation: 0.95, tx_count: 688,  active: true, endpoint: `${AGENT_B_SOL}/smart-contract-audit` },
  { id: "sol-market",   name: "market-analyst-sol",   service: "market_analysis",      chain: "solana-devnet",  price_usd: 0.025, reputation: 0.88, tx_count: 1447, active: true, endpoint: `${AGENT_B_SOL}/market-analysis` },
];

// Try Anchor with a strict 8s timeout — never block the response
async function fetchAnchorAgents(): Promise<any[]> {
  return new Promise((resolve) => {
    try {
      const projectRoot = path.resolve(process.cwd(), "..");
      const tsNode = path.join(projectRoot, "node_modules", ".bin", "ts-node");
      const clientScript = path.join(projectRoot, "scripts", "anchor_client.ts");

      const child = spawn(
        tsNode,
        ["--skip-project", "--transpile-only", clientScript, "discover", ""],
        { cwd: projectRoot, env: { ...process.env, TS_NODE_SKIP_IGNORE: "true" }, timeout: 10000 }
      );

      let stdout = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });

      const timer = setTimeout(() => { child.kill(); resolve([]); }, 8000);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 || !stdout.trim()) { resolve([]); return; }
        try { resolve(JSON.parse(stdout.trim())); } catch { resolve([]); }
      });
      child.on("error", () => { clearTimeout(timer); resolve([]); });
    } catch {
      resolve([]);
    }
  });
}

// Merge live Anchor data on top of fallback (live wins for matching names)
function mergeAgents(anchor: any[], fallback: any[]) {
  if (!anchor.length) return fallback;
  const byName = new Map(fallback.map((a) => [a.name, a]));
  const merged = [...fallback];
  for (const a of anchor) {
    const name = a.name ?? a.id;
    const idx = merged.findIndex((m) => m.name === name);
    if (idx >= 0) {
      merged[idx] = {
        ...merged[idx],
        reputation: a.reputation ? a.reputation / 1000 : merged[idx].reputation,
        tx_count: a.totalJobs ?? merged[idx].tx_count,
        active: a.active ?? true,
        pda: a.pda,
      };
    } else if (!byName.has(name)) {
      merged.push({
        id: a.pda ?? a.name,
        name: a.name,
        service: a.service,
        endpoint: a.endpoint ?? `${AGENT_B_SOL}/${a.service?.replace(/_/g, "-")}`,
        chain: "solana-devnet",
        price_usd: (a.price ?? 0) / 1_000_000,
        reputation: (a.reputation ?? 800) / 1000,
        tx_count: a.totalJobs ?? 0,
        active: a.active ?? true,
        pda: a.pda,
      });
    }
  }
  return merged;
}

export async function GET() {
  // Always return within a reasonable time — never hang
  try {
    // Race Anchor fetch against a 6s deadline, fallback wins if Anchor is slow
    const anchorResult = await Promise.race([
      fetchAnchorAgents(),
      new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 6000)),
    ]);

    const agents = mergeAgents(anchorResult, FALLBACK_REGISTRY);
    return NextResponse.json({
      agents,
      source: anchorResult.length > 0 ? "anchor+fallback" : "fallback",
      anchorCount: anchorResult.length,
      total: agents.length,
    });
  } catch (err) {
    console.error("[/api/agents] Error:", err);
    return NextResponse.json({
      agents: FALLBACK_REGISTRY,
      source: "fallback",
      total: FALLBACK_REGISTRY.length,
    });
  }
}
