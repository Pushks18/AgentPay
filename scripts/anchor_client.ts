import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, web3, BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { createHash } from "crypto";
import WebSocket from "ws";

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

// ---------------------------------------------------------------------------
// RPC + provider
// ---------------------------------------------------------------------------

const RPC_URL =
  process.env.SOLANA_RPC ||
  `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

function loadKeypair(bs58Key: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(bs58Key));
}

function requirePublicKey(value: string | PublicKey | undefined, label: string): PublicKey {
  if (!value) {
    throw new Error(`${label} is missing`);
  }
  try {
    return value instanceof PublicKey ? value : new PublicKey(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function requireU64(value: number, label: string): BN {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return new BN(Math.trunc(value));
}

export function getProvider(payerKey?: string): AnchorProvider {
  const connection = getConnection();
  const payer = payerKey
    ? loadKeypair(payerKey)
    : loadKeypair(process.env.AGENT_A_SOL_PRIVATE_KEY_BS58!);
  const wallet = new anchor.Wallet(payer);
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    skipPreflight: false,
  });
}

// ---------------------------------------------------------------------------
// Program loaders
// ---------------------------------------------------------------------------

function accountDiscriminator(name: string): number[] {
  return Array.from(
    createHash("sha256").update(`account:${name}`).digest().subarray(0, 8)
  );
}

function eventDiscriminator(name: string): number[] {
  return Array.from(
    createHash("sha256").update(`event:${name}`).digest().subarray(0, 8)
  );
}

function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function instructionDiscriminator(name: string): number[] {
  return Array.from(
    createHash("sha256").update(`global:${toSnakeCase(name)}`).digest().subarray(0, 8)
  );
}

function normalizeInstructionAccounts(accounts: any[] | undefined): void {
  if (!Array.isArray(accounts)) {
    return;
  }

  for (const account of accounts) {
    if ("isMut" in account && !("writable" in account)) {
      account.writable = account.isMut;
    }
    if ("isSigner" in account && !("signer" in account)) {
      account.signer = account.isSigner;
    }
    normalizeInstructionAccounts(account.accounts);
  }
}

function normalizeIdlType(type: any): any {
  if (type === "publicKey") {
    return "pubkey";
  }

  if (Array.isArray(type)) {
    return type.map(normalizeIdlType);
  }

  if (type && typeof type === "object") {
    return Object.fromEntries(
      Object.entries(type).map(([key, value]) => [key, normalizeIdlType(value)])
    );
  }

  return type;
}

function loadIdl(name: string): anchor.Idl & { address?: string; metadata?: { address?: string } } {
  const idlPath = path.resolve(__dirname, `../target/idl/${name}.json`);
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  if (!idl.address && idl.metadata?.address) {
    idl.address = idl.metadata.address;
  }

  if (Array.isArray(idl.instructions)) {
    for (const instruction of idl.instructions) {
      if (!instruction.discriminator) {
        instruction.discriminator = instructionDiscriminator(instruction.name);
      }

      normalizeInstructionAccounts(instruction.accounts);

      if (Array.isArray(instruction.args)) {
        for (const arg of instruction.args) {
          arg.type = normalizeIdlType(arg.type);
        }
      }
    }
  }

  if (Array.isArray(idl.accounts)) {
    idl.types ??= [];

    for (const account of idl.accounts) {
      account.type = normalizeIdlType(account.type);

      if (!account.discriminator) {
        account.discriminator = accountDiscriminator(account.name);
      }

      if (!idl.types.some((typeDef: { name: string }) => typeDef.name === account.name)) {
        idl.types.push({
          name: account.name,
          type: account.type,
        });
      }
    }
  }

  if (Array.isArray(idl.events)) {
    idl.types ??= [];

    for (const event of idl.events) {
      if (!event.discriminator) {
        event.discriminator = eventDiscriminator(event.name);
      }

      const eventType = {
        kind: "struct",
        fields: event.fields.map((field: any) => ({
          name: field.name,
          type: normalizeIdlType(field.type),
        })),
      };

      if (!idl.types.some((typeDef: { name: string }) => typeDef.name === event.name)) {
        idl.types.push({
          name: event.name,
          type: eventType,
        });
      }
    }
  }

  return idl;
}

function loadProgram(
  name: string,
  addressEnvKey: string,
  provider: AnchorProvider
): Program {
  const idl = loadIdl(name);
  const programId = requirePublicKey(process.env[addressEnvKey] || idl.address, addressEnvKey);
  idl.address = programId.toBase58();
  return new Program(idl as anchor.Idl, provider);
}

export function getRegistryProgram(provider: AnchorProvider): Program {
  return loadProgram("agent_registry", "AGENT_REGISTRY_PROGRAM_ID", provider);
}

export function getEscrowProgram(provider: AnchorProvider): Program {
  return loadProgram("escrow", "ESCROW_PROGRAM_ID", provider);
}

export function getStakingProgram(provider: AnchorProvider): Program {
  return loadProgram("staking", "STAKING_PROGRAM_ID", provider);
}

// ---------------------------------------------------------------------------
// Helper: derive agent PDA
// ---------------------------------------------------------------------------

export function agentPDA(
  owner: PublicKey,
  name: string,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), owner.toBuffer(), Buffer.from(name)],
    programId
  );
}

export function escrowPDA(
  buyer: PublicKey,
  jobId: Buffer,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), buyer.toBuffer(), jobId],
    programId
  );
}

export function stakePDA(
  agent: PublicKey,
  name: string,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), agent.toBuffer(), Buffer.from(name)],
    programId
  );
}

// ---------------------------------------------------------------------------
// Registry functions
// ---------------------------------------------------------------------------

export async function registerAgent(
  name: string,
  service: string,
  endpoint: string,
  price: number, // USDC micro-units
  ownerKey?: string
): Promise<{ txHash: string; agentPda: string }> {
  const provider = getProvider(ownerKey);
  const program = getRegistryProgram(provider);
  const owner = requirePublicKey(
    (provider.wallet as anchor.Wallet).payer?.publicKey,
    "owner public key"
  );
  const [pda] = agentPDA(owner, name, program.programId);
  const priceBn = requireU64(price, "price");

  const tx = await (program.methods as any)
    .registerAgent(name, service, endpoint, priceBn)
    .accountsStrict({
      agent: pda,
      owner,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`✅ Registered agent "${name}" | PDA: ${pda.toBase58()} | TX: ${tx}`);
  return { txHash: tx, agentPda: pda.toBase58() };
}

export async function discoverAgents(
  service: string,
  ownerKey?: string
): Promise<any[]> {
  const provider = getProvider(ownerKey);
  const program = getRegistryProgram(provider);

  // Fetch all Agent accounts filtered by service discriminator
  const accounts = await (program.account as any).agent.all();
  return accounts
    .map((a: any) => ({
      pda: a.publicKey.toBase58(),
      ...a.account,
      price_usd: (a.account as any).price.toNumber() / 1_000_000,
    }))
    .filter(
      (a: any) =>
        a.active &&
        (service === "" || a.service === service)
    );
}

// ---------------------------------------------------------------------------
// Escrow functions
// ---------------------------------------------------------------------------

export async function createEscrow(
  sellerPubkey: string,
  arbitratorPubkey: string,
  amountUsdc: number,
  jobId: string, // hex string
  buyerKey?: string
): Promise<{ txHash: string; escrowPda: string; deadline: number }> {
  const provider = getProvider(buyerKey);
  const program = getEscrowProgram(provider);
  const buyer = (provider.wallet as anchor.Wallet).payer.publicKey;

  const jobIdBytes = Buffer.from(jobId.replace("0x", "").padEnd(64, "0"), "hex");
  const [pda] = escrowPDA(buyer, jobIdBytes, program.programId);
  const mint = new PublicKey(process.env.USDC_DEVNET_MINT!);
  const seller = new PublicKey(sellerPubkey);
  const arbitrator = new PublicKey(arbitratorPubkey);

  const buyerAta = getAssociatedTokenAddressSync(mint, buyer);
  const vaultAta = getAssociatedTokenAddressSync(mint, pda, true);

  const timeout = 120; // 2 minutes
  const deadline = Math.floor(Date.now() / 1000) + timeout;

  const tx = await (program.methods as any)
    .createEscrow(Array.from(jobIdBytes), new BN(amountUsdc), new BN(timeout))
    .accountsStrict({
      escrow: pda,
      vault: vaultAta,
      buyerToken: buyerAta,
      buyer,
      seller,
      arbitrator,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`✅ Escrow created | PDA: ${pda.toBase58()} | TX: ${tx}`);
  return { txHash: tx, escrowPda: pda.toBase58(), deadline };
}

export async function releasePayment(
  jobId: string,
  sellerPubkey: string,
  buyerKey?: string
): Promise<string> {
  const provider = getProvider(buyerKey);
  const program = getEscrowProgram(provider);
  const buyer = (provider.wallet as anchor.Wallet).payer.publicKey;

  const jobIdBytes = Buffer.from(jobId.replace("0x", "").padEnd(64, "0"), "hex");
  const [pda] = escrowPDA(buyer, jobIdBytes, program.programId);
  const mint = new PublicKey(process.env.USDC_DEVNET_MINT!);
  const seller = new PublicKey(sellerPubkey);
  const sellerAta = getAssociatedTokenAddressSync(mint, seller);
  const vaultAta = getAssociatedTokenAddressSync(mint, pda, true);

  const tx = await (program.methods as any)
    .releasePayment(Array.from(jobIdBytes))
    .accountsStrict({
      escrow: pda,
      vault: vaultAta,
      recipientToken: sellerAta,
      authority: buyer,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`✅ Payment released | TX: ${tx}`);
  return tx;
}

export async function refundEscrow(
  jobId: string,
  buyerKey?: string
): Promise<string> {
  const provider = getProvider(buyerKey);
  const program = getEscrowProgram(provider);
  const buyer = (provider.wallet as anchor.Wallet).payer.publicKey;

  const jobIdBytes = Buffer.from(jobId.replace("0x", "").padEnd(64, "0"), "hex");
  const [pda] = escrowPDA(buyer, jobIdBytes, program.programId);
  const mint = new PublicKey(process.env.USDC_DEVNET_MINT!);
  const buyerAta = getAssociatedTokenAddressSync(mint, buyer);
  const vaultAta = getAssociatedTokenAddressSync(mint, pda, true);

  const tx = await (program.methods as any)
    .refund(Array.from(jobIdBytes))
    .accountsStrict({
      escrow: pda,
      vault: vaultAta,
      recipientToken: buyerAta,
      authority: buyer,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`✅ Escrow refunded | TX: ${tx}`);
  return tx;
}

// ---------------------------------------------------------------------------
// Staking
// ---------------------------------------------------------------------------

export async function stakeAgent(
  agentName: string,
  amountLamports: number,
  agentKey?: string
): Promise<string> {
  const provider = getProvider(agentKey);
  const program = getStakingProgram(provider);
  const agent = requirePublicKey(
    (provider.wallet as anchor.Wallet).payer?.publicKey,
    "agent public key"
  );
  const [pda] = stakePDA(agent, agentName, program.programId);
  const amountBn = requireU64(amountLamports, "stake amount");

  const tx = await (program.methods as any)
    .stake(agentName, amountBn)
    .accountsStrict({
      stake: pda,
      agent,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`✅ Staked ${amountLamports} lamports for "${agentName}" | TX: ${tx}`);
  return tx;
}

export async function slashVote(
  agentOwner: string,
  agentName: string,
  jobId: string,
  evidence: string,
  voterKey?: string
): Promise<string> {
  const provider = getProvider(voterKey);
  const program = getStakingProgram(provider);
  const voter = (provider.wallet as anchor.Wallet).payer.publicKey;

  const agentPub = new PublicKey(agentOwner);
  const [pda] = stakePDA(agentPub, agentName, program.programId);

  const jobIdBytes = Buffer.from(jobId.replace("0x", "").padEnd(64, "0"), "hex");
  const BURN_PUB = new PublicKey("BurnAgntPay111111111111111111111111111111111");

  const tx = await (program.methods as any)
    .voteSlash(agentName, Array.from(jobIdBytes), evidence)
    .accountsStrict({
      stake: pda,
      voter,
      burnAddress: BURN_PUB,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`✅ Slash vote cast | TX: ${tx}`);
  return tx;
}

// ---------------------------------------------------------------------------
// WebSocket event listener (Helius webhook alternative)
// ---------------------------------------------------------------------------

export function watchEscrowEvents(
  onEvent: (eventType: string, data: any) => void
): () => void {
  const connection = getConnection();
  const programId = new PublicKey(process.env.ESCROW_PROGRAM_ID!);

  const subscriptionId = connection.onLogs(programId, (logs) => {
    const logStr = logs.logs.join("\n");

    if (logStr.includes("EscrowCreated")) {
      onEvent("EscrowCreated", { signature: logs.signature });
    } else if (logStr.includes("EscrowReleased")) {
      onEvent("EscrowReleased", { signature: logs.signature });
    } else if (logStr.includes("EscrowRefunded")) {
      onEvent("EscrowRefunded", { signature: logs.signature });
    } else if (logStr.includes("DisputeRaised")) {
      onEvent("DisputeRaised", { signature: logs.signature });
    } else if (logStr.includes("AgentSlashed")) {
      onEvent("AgentSlashed", { signature: logs.signature });
    }
  });

  return () => {
    connection.removeOnLogsListener(subscriptionId);
  };
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command) throw new Error("Missing command");

  if (command === "discover" || command === "discover_agents") {
    const service = args[0] || "";
    console.log(JSON.stringify(await discoverAgents(service)));
    return;
  }
  if (command === "create_escrow") {
    const [sellerPubkey, arbitratorPubkey, amountMicroStr, jobId, buyerKey] = args;
    console.log(
      JSON.stringify(
        await createEscrow(sellerPubkey, arbitratorPubkey, Number(amountMicroStr), jobId, buyerKey)
      )
    );
    return;
  }
  if (command === "release_payment") {
    const [jobId, sellerPubkey, buyerKey] = args;
    console.log(JSON.stringify(await releasePayment(jobId, sellerPubkey, buyerKey)));
    return;
  }
  if (command === "refund_escrow") {
    const [jobId, buyerKey] = args;
    console.log(JSON.stringify(await refundEscrow(jobId, buyerKey)));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  });
}
