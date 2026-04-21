/**
 * Light Protocol ZK-compressed reputation mint.
 *
 * Commands:
 *   node zk_reputation.mjs init          → creates mint, prints REPUTATION_MINT=...
 *   node zk_reputation.mjs <addr> <n>    → mints n compressed tokens to addr
 */

import 'dotenv/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createRpc } from '@lightprotocol/stateless.js';
import { createMint, mintTo } from '@lightprotocol/compressed-token';
import bs58 from 'bs58';

const { HELIUS_API_KEY, SOL_PAYER_BS58, REPUTATION_MINT } = process.env;

if (!HELIUS_API_KEY) {
  console.error('HELIUS_API_KEY not set in .env');
  process.exit(1);
}

if (!SOL_PAYER_BS58) {
  console.error('SOL_PAYER_BS58 not set in .env');
  process.exit(1);
}

const RPC_URL = `https://devnet.helius-rpc.com?api-key=${HELIUS_API_KEY}`;

// Light Protocol requires three RPC endpoints: RPC, compression RPC, prover.
// Helius devnet supports all three at the same URL.
const rpc = createRpc(RPC_URL, RPC_URL, RPC_URL);

const payer = Keypair.fromSecretKey(bs58.decode(SOL_PAYER_BS58));

// ---------------------------------------------------------------------------
// Init: create the reputation mint (run once)
// ---------------------------------------------------------------------------

if (process.argv[2] === 'init') {
  console.log(`Creating compressed-token mint...`);
  const { mint, transactionSignature } = await createMint(
    rpc,
    payer,       // fee payer
    payer.publicKey, // mint authority
    0,           // decimals (whole reputation points)
  );
  console.log(`REPUTATION_MINT=${mint.toBase58()}`);
  console.log(`TX: https://explorer.solana.com/tx/${transactionSignature}?cluster=devnet`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Mint: award n reputation tokens to an agent
// ---------------------------------------------------------------------------

const [, , agentAddress, pointsArg] = process.argv;

if (!agentAddress || !pointsArg) {
  console.error('Usage: node zk_reputation.mjs <agentAddress> <points>');
  process.exit(1);
}

if (!REPUTATION_MINT) {
  console.error('REPUTATION_MINT not set — run `node zk_reputation.mjs init` first');
  process.exit(1);
}

const mint = new PublicKey(REPUTATION_MINT);
const recipient = new PublicKey(agentAddress);
const points = BigInt(pointsArg);

try {
  const sig = await mintTo(
    rpc,
    payer,           // fee payer
    mint,            // mint address
    recipient,       // destination wallet (ATA created idempotently by Light Protocol)
    payer,           // mint authority
    points,
  );

  const result = {
    sig,
    compressed: true,
    points: pointsArg,
    recipient: agentAddress,
    explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
  };

  console.log(JSON.stringify(result));
} catch (err) {
  console.error('Mint failed:', err.message);
  process.exit(1);
}
