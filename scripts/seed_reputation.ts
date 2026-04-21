/**
 * Seeds realistic demo data so Agent B looks established, not brand new.
 *
 * What it does:
 *   1. Mints 100 compressed reputation tokens to Agent B via Light Protocol
 *   2. Submits 5 ERC-8004 reputation feedbacks from Agent A to Agent B on Fuji
 *   3. Increments Agent B's Anchor reputation counter 5 times
 *
 * Run: npx ts-node scripts/seed_reputation.ts
 */

import * as child_process from "child_process";
import * as dotenv from "dotenv";
import * as path from "path";
import { promisify } from "util";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { getProvider, getRegistryProgram, agentPDA } from "./anchor_client";
import { BN, web3 } from "@coral-xyz/anchor";
import { Web3 } from "web3";

const exec = promisify(child_process.exec);

const AGENT_B_SOL = process.env.AGENT_B_SOLANA_ADDRESS!;
const ZK_SCRIPT = path.resolve(__dirname, "../agent_b/zk_reputation.mjs");

// ---------------------------------------------------------------------------
// 1. Mint 100 compressed reputation tokens via Light Protocol
// ---------------------------------------------------------------------------

async function seedSolanaReputation() {
  console.log("\n=== Seeding Solana ZK reputation (100 tokens) ===");
  try {
    const { stdout } = await exec(`node ${ZK_SCRIPT} ${AGENT_B_SOL} 100`, {
      env: { ...process.env },
    });
    const result = JSON.parse(stdout.trim());
    console.log(`  ✅ Minted 100 compressed tokens`);
    console.log(`     TX: ${result.explorer}`);
  } catch (e: any) {
    console.log(`  ⚠️  ZK mint: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Submit 5 ERC-8004 reputation feedbacks on Fuji
// ---------------------------------------------------------------------------

const REP_ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "bytes32" },
      { name: "tag2", type: "bytes32" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [{ name: "feedbackIndex", type: "uint256" }],
  },
] as const;

async function seedAvaxReputation() {
  console.log("\n=== Seeding Avalanche ERC-8004 reputation (5 feedbacks) ===");

  const w3 = new Web3(process.env.FUJI_RPC!);
  const rep = new w3.eth.Contract(REP_ABI as any, process.env.ERC8004_REPUTATION!);
  const account = w3.eth.accounts.privateKeyToAccount(process.env.AGENT_A_EVM_PRIVATE_KEY!);
  w3.eth.accounts.wallet.add(account);

  const scores = [91, 89, 94, 87, 92];

  for (let i = 0; i < scores.length; i++) {
    try {
      const gas = await (rep.methods as any)
        .giveFeedback(1, scores[i], 2, "0x" + "00".repeat(32), "0x" + "00".repeat(32), "", "0x" + "00".repeat(32))
        .estimateGas({ from: account.address });

      const tx = await (rep.methods as any)
        .giveFeedback(1, scores[i], 2, "0x" + "00".repeat(32), "0x" + "00".repeat(32), "", "0x" + "00".repeat(32))
        .send({ from: account.address, gas: Math.floor(Number(gas) * 1.2).toString() });

      console.log(`  ✅ Feedback ${i + 1}/5 score=${scores[i]} TX: https://testnet.snowtrace.io/tx/${tx.transactionHash}`);

      // Wait 2s between txs to avoid nonce issues
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e: any) {
      console.log(`  ⚠️  Feedback ${i + 1}: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Increment Anchor reputation counter
// ---------------------------------------------------------------------------

async function seedAnchorReputation() {
  console.log("\n=== Seeding Anchor on-chain reputation counter ===");
  try {
    const provider = getProvider(process.env.AGENT_A_SOL_PRIVATE_KEY_BS58);
    const program = getRegistryProgram(provider);
    const agentOwner = web3.Keypair.fromSecretKey(
      require("bs58").decode(process.env.AGENT_B_SOL_PRIVATE_KEY_BS58!)
    );
    const [pda] = agentPDA(agentOwner.publicKey, "trust-reporter", program.programId);

    for (let i = 0; i < 5; i++) {
      try {
        const tx = await (program.methods as any)
          .incrementReputation("trust-reporter", new BN(10))
          .accounts({ agent: pda, owner: agentOwner.publicKey })
          .signers([agentOwner])
          .rpc();
        console.log(`  ✅ Increment ${i + 1}/5 | TX: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e: any) {
        console.log(`  ⚠️  Increment ${i + 1}: ${e.message}`);
      }
    }
  } catch (e: any) {
    console.log(`  ⚠️  Anchor reputation seeding: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log("AgentPay — Reputation Seeder");
  console.log("Agent B Solana:", AGENT_B_SOL);

  await seedSolanaReputation();
  await seedAvaxReputation();
  await seedAnchorReputation();

  console.log("\n✅ Seeding complete — Agent B reputation is now established.");
  console.log("   Score visible at: https://explorer.solana.com/address/" + AGENT_B_SOL + "?cluster=devnet");
})();
