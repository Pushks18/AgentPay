import 'dotenv/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createRpc } from '@lightprotocol/stateless.js';
import { createMint, mintTo } from '@lightprotocol/compressed-token';
import bs58 from 'bs58';

const RPC = `https://devnet.helius-rpc.com?api-key=${process.env.HELIUS_API_KEY}`;
const rpc = createRpc(RPC, RPC, RPC);
const payer = Keypair.fromSecretKey(bs58.decode(process.env.SOL_PAYER_BS58));

if (process.argv[2] === 'init') {
  // Run once to create the mint; save output to .env as REPUTATION_MINT
  const { mint } = await createMint(rpc, payer, payer.publicKey, 0);
  console.log('REPUTATION_MINT=' + mint.toBase58());
  process.exit(0);
}

// Usage: node zk_reputation.mjs <agentAddress> <points>
const [, , agentAddress, points] = process.argv;
if (!agentAddress || !points) {
  console.error('Usage: node zk_reputation.mjs <agentAddress> <points>');
  process.exit(1);
}

const mint = new PublicKey(process.env.REPUTATION_MINT);
const sig = await mintTo(
  rpc,
  payer,
  mint,
  new PublicKey(agentAddress),
  payer,
  BigInt(points),
);

console.log(JSON.stringify({
  sig,
  explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
}));
