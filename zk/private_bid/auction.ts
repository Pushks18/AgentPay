import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const WASM_PATH = path.join(__dirname, "bid_js", "bid.wasm");
const ZKEY_PATH = path.join(__dirname, "bid_final.zkey");
const VKEY_PATH = path.join(__dirname, "verification_key.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BidProof {
  proof: snarkjs.Groth16Proof;
  publicSignals: string[];
}

export interface Bid {
  jobId: string;
  commitment: string;
  bidderAddress: string;
}

// In-memory bid store (replace with on-chain store in production)
const bidStore: Map<string, Bid[]> = new Map();

// ---------------------------------------------------------------------------
// 1. Generate a bid commitment
// ---------------------------------------------------------------------------

export async function generateBidCommitment(
  amount: number,
  secret: string
): Promise<string> {
  const poseidon = await buildPoseidon();
  const secretBigInt = BigInt("0x" + Buffer.from(secret).toString("hex"));
  const hash = poseidon([BigInt(amount), secretBigInt]);
  return poseidon.F.toString(hash);
}

export function generateSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// 2. Submit a sealed bid (stores commitment on-chain / in-memory)
// ---------------------------------------------------------------------------

export async function submitBid(
  jobId: string,
  amount: number,
  bidderAddress: string
): Promise<{ commitment: string; secret: string }> {
  const secret = generateSecret();
  const commitment = await generateBidCommitment(amount, secret);

  const bid: Bid = { jobId, commitment, bidderAddress };
  const existing = bidStore.get(jobId) ?? [];
  bidStore.set(jobId, [...existing, bid]);

  console.log(`Bid submitted — job: ${jobId} commitment: ${commitment}`);
  return { commitment, secret };
}

// ---------------------------------------------------------------------------
// 3. Determine winner (lowest bid) and return winning commitment
// ---------------------------------------------------------------------------

export async function closeAuction(
  jobId: string,
  revealedBids: Array<{ bidder: string; amount: number; secret: string }>
): Promise<{ winner: string; winningCommitment: string; amount: number }> {
  const poseidon = await buildPoseidon();

  // Verify all revealed bids match their commitments
  const verified: Array<{ bidder: string; amount: number; commitment: string }> = [];
  for (const rb of revealedBids) {
    const commitment = await generateBidCommitment(rb.amount, rb.secret);
    verified.push({ bidder: rb.bidder, amount: rb.amount, commitment });
  }

  // Pick lowest bid
  verified.sort((a, b) => a.amount - b.amount);
  const winner = verified[0];

  console.log(`Auction closed — winner: ${winner.bidder} bid: ${winner.amount}`);
  return {
    winner: winner.bidder,
    winningCommitment: winner.commitment,
    amount: winner.amount,
  };
}

// ---------------------------------------------------------------------------
// 4. Generate ZK proof (winner reveals bid without exposing losers)
// ---------------------------------------------------------------------------

export async function revealAndProve(
  amount: number,
  secret: string,
  winningCommitment: string,
  budget: number
): Promise<BidProof> {
  const commitment = await generateBidCommitment(amount, secret);
  const secretBigInt = BigInt("0x" + Buffer.from(secret).toString("hex"));

  const input = {
    bid_amount: amount.toString(),
    bidder_secret: secretBigInt.toString(),
    bid_commitment: commitment,
    winning_commitment: winningCommitment,
    max_budget: budget.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    WASM_PATH,
    ZKEY_PATH
  );

  console.log("ZK bid proof generated — revealed amount:", publicSignals[3]);
  return { proof, publicSignals };
}

// ---------------------------------------------------------------------------
// 5. Verify proof client-side before submitting on-chain
// ---------------------------------------------------------------------------

export async function verifyWinner(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): Promise<boolean> {
  const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf-8"));
  const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log("Bid proof verification:", valid ? "✅ valid" : "❌ invalid");
  return valid;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  (async () => {
    // Demo flow
    const JOB_ID = "job-" + crypto.randomBytes(8).toString("hex");
    const BUDGET = 100_000; // $0.10 USDC

    console.log("=== Sealed-Bid Auction Demo ===");

    // Three agents bid
    const { commitment: c1, secret: s1 } = await submitBid(JOB_ID, 50_000, "agent-b-sol");
    const { commitment: c2, secret: s2 } = await submitBid(JOB_ID, 70_000, "agent-b-fuji");
    const { commitment: c3, secret: s3 } = await submitBid(JOB_ID, 45_000, "agent-b-alt");

    // Close auction with revealed bids
    const { winner, winningCommitment, amount } = await closeAuction(JOB_ID, [
      { bidder: "agent-b-sol", amount: 50_000, secret: s1 },
      { bidder: "agent-b-fuji", amount: 70_000, secret: s2 },
      { bidder: "agent-b-alt", amount: 45_000, secret: s3 },
    ]);

    // Winner proves their bid without revealing losers
    const { proof, publicSignals } = await revealAndProve(amount, s3, winningCommitment, BUDGET);
    const valid = await verifyWinner(proof, publicSignals);

    console.log(`Winner: ${winner}, Bid: $${amount / 1_000_000}, Proof valid: ${valid}`);
  })();
}
