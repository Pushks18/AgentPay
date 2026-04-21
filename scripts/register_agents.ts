/**
 * Registers Agent B on both chains and stakes SOL.
 * Run after `anchor deploy` and after filling .env.
 *
 * Usage: npx ts-node scripts/register_agents.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { Web3 } from "web3";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import {
  discoverAgents,
  getProvider,
  registerAgent,
  stakeAgent,
} from "./anchor_client";

const AGENT_B_SOL_URL = process.env.AGENT_B_SOL_URL || "http://localhost:8002";
const AGENT_B_SOL_KEY = process.env.AGENT_B_SOL_PRIVATE_KEY_BS58!;

const FUJI_RPC = process.env.FUJI_RPC!;
const AGENT_B_EVM_ADDR = process.env.AGENT_B_EVM_ADDRESS!;
const AGENT_B_FUJI_URL = process.env.AGENT_B_FUJI_URL || "http://localhost:8001";

// ERC-8004 IdentityRegistry ABI (newer register style)
const IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Register on Solana (Anchor)
// ---------------------------------------------------------------------------

async function registerOnSolana() {
  console.log("\n=== Registering agents on Solana (Anchor) ===");

  const services: Array<{ name: string; service: string; price: number }> = [
    { name: "trust-reporter", service: "trust_report", price: 5_000 },   // $0.005
    { name: "code-reviewer", service: "code_review", price: 25_000 },    // $0.025
    { name: "summarizer", service: "summarize", price: 10_000 },          // $0.01
    { name: "sql-generator", service: "sql_generator", price: 15_000 },   // $0.015
  ];

  const pdas: string[] = [];

  for (const svc of services) {
    try {
      const { txHash, agentPda } = await registerAgent(
        svc.name,
        svc.service,
        `${AGENT_B_SOL_URL}/${svc.service.replace("_", "-")}`,
        svc.price,
        AGENT_B_SOL_KEY
      );
      pdas.push(agentPda);
      console.log(`  ✅ ${svc.name}`);
      console.log(`     PDA: ${agentPda}`);
      console.log(`     TX : https://explorer.solana.com/tx/${txHash}?cluster=devnet`);
    } catch (e: any) {
      console.log(`  ⚠️  ${svc.name}: ${e.message}`);
    }
  }

  return pdas;
}

// ---------------------------------------------------------------------------
// Stake SOL for each agent
// ---------------------------------------------------------------------------

async function stakeOnSolana(agentNames: string[]) {
  console.log("\n=== Staking SOL for each agent ===");
  const STAKE_AMOUNT = 150_000_000; // 0.15 SOL

  for (const name of agentNames) {
    try {
      const tx = await stakeAgent(name, STAKE_AMOUNT, AGENT_B_SOL_KEY);
      console.log(`  ✅ Staked for ${name} | TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
    } catch (e: any) {
      console.log(`  ⚠️  Stake for ${name}: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Register on Avalanche ERC-8004
// ---------------------------------------------------------------------------

async function registerOnAvalanche() {
  console.log("\n=== Registering Agent B on ERC-8004 IdentityRegistry (Fuji) ===");

  const w3 = new Web3(FUJI_RPC);
  const identity = new w3.eth.Contract(
    IDENTITY_ABI as any,
    process.env.ERC8004_IDENTITY!
  );

  const agentCard = JSON.stringify({
    name: "agentpay-seller-fuji",
    description: "AgentPay seller: trust reports, code reviews, summaries, SQL generation",
    endpoint: AGENT_B_FUJI_URL,
    services: [
      { name: "trust_report", path: "/trust-report", price: "$0.01" },
      { name: "code_review", path: "/code-review", price: "$0.05" },
      { name: "summarize", path: "/summarize", price: "$0.02" },
      { name: "sql_generator", path: "/sql-generator", price: "$0.03" },
    ],
    chain: "avalanche-fuji",
    version: "1.0.0",
  });

  // In production, upload agentCard to IPFS and pass the URI.
  // For hackathon: pass a data URI directly.
  const agentURI = `data:application/json;base64,${Buffer.from(agentCard).toString("base64")}`;
  // Fund Agent B EVM wallet with 0.1 AVAX on Fuji testnet to enable ERC-8004 registration.

  const account = w3.eth.accounts.privateKeyToAccount(
    process.env.AGENT_B_EVM_PRIVATE_KEY!
  );
  w3.eth.accounts.wallet.add(account);

  try {
    const gas = await (identity.methods as any).register(agentURI).estimateGas({
      from: account.address,
    });
    const tx = await (identity.methods as any).register(agentURI).send({
      from: account.address,
      gas: Math.floor(Number(gas) * 1.2).toString(),
    });
    const agentId = tx.events?.Transfer?.returnValues?.tokenId ?? "unknown";
    console.log(`  ✅ Registered on ERC-8004`);
    console.log(`     Agent ID : ${agentId}`);
    console.log(`     TX       : https://testnet.snowtrace.io/tx/${tx.transactionHash}`);
    return agentId;
  } catch (e: any) {
    console.log(`  ⚠️  ERC-8004 registration skipped: ${e.message}`);
    console.log(`     Fund Agent B EVM wallet with 0.1 AVAX on Fuji testnet to enable ERC-8004 registration.`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log("AgentPay — Agent Registration Script");
  console.log("=====================================");

  const pdas = await registerOnSolana();
  await stakeOnSolana(["trust-reporter", "code-reviewer", "summarizer", "sql-generator"]);
  const evmAgentId = await registerOnAvalanche();

  console.log("\n=== Summary ===");
  console.log(`  Solana PDAs   : ${pdas.join(", ")}`);
  console.log(`  EVM Agent ID  : ${evmAgentId}`);
  console.log("\nAdd AGENT_REGISTRY_PROGRAM_ID to .env if not already set.");
  console.log("Then run: npx ts-node scripts/seed_reputation.ts");
})();
