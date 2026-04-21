//! SP1 prover script: reads agent data from Solana devnet, builds a merkle
//! tree of all registered agents, generates a Groth16 proof for a target agent,
//! and saves proof + public values to proof_output.json.
//!
//! Usage: cargo run --release -- <AGENT_PUBKEY> <THRESHOLD>

use dotenv::dotenv;
use hex;
use serde::{Deserialize, Serialize};
use serde_json;
use sha2::{Digest, Sha256};
use sp1_sdk::{ProverClient, SP1Stdin};
use std::env;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentEntry {
    pubkey: [u8; 32],
    reputation: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProofOutput {
    proof: String,
    public_values: String,
    is_qualified: bool,
    reputation_tier: u8,
    merkle_root: String,
    agent_pubkey: String,
    threshold: u64,
}

// ---------------------------------------------------------------------------
// Merkle helpers (must mirror guest program)
// ---------------------------------------------------------------------------

fn hash_leaf(pubkey: &[u8; 32], score: u64) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(pubkey);
    h.update(score.to_le_bytes());
    h.finalize().into()
}

fn hash_pair(l: &[u8; 32], r: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    if l <= r {
        h.update(l);
        h.update(r);
    } else {
        h.update(r);
        h.update(l);
    }
    h.finalize().into()
}

fn build_merkle_tree(leaves: &[[u8; 32]]) -> Vec<Vec<[u8; 32]>> {
    let mut tree: Vec<Vec<[u8; 32]>> = vec![leaves.to_vec()];
    while tree.last().unwrap().len() > 1 {
        let prev = tree.last().unwrap();
        let mut next = Vec::new();
        let mut i = 0;
        while i < prev.len() {
            let left = prev[i];
            let right = if i + 1 < prev.len() { prev[i + 1] } else { left };
            next.push(hash_pair(&left, &right));
            i += 2;
        }
        tree.push(next);
    }
    tree
}

fn generate_proof(tree: &[Vec<[u8; 32]>], leaf_index: usize) -> Vec<[u8; 32]> {
    let mut proof = Vec::new();
    let mut idx = leaf_index;
    for level in &tree[..tree.len() - 1] {
        let sibling_idx = if idx % 2 == 0 { idx + 1 } else { idx - 1 };
        if sibling_idx < level.len() {
            proof.push(level[sibling_idx]);
        } else {
            proof.push(level[idx]); // duplicate last node
        }
        idx /= 2;
    }
    proof
}

// ---------------------------------------------------------------------------
// Fetch agents from Solana (stubbed to mock data for hackathon speed)
// In production: use solana_client::rpc_client::RpcClient::get_program_accounts()
// ---------------------------------------------------------------------------

fn fetch_agents_from_devnet(rpc_url: &str, target_pubkey: &[u8; 32]) -> Vec<AgentEntry> {
    // Demo: return a list that includes the target agent with reputation 847
    // In production, deserialize Anchor account data from getProgramAccounts
    vec![
        AgentEntry {
            pubkey: *target_pubkey,
            reputation: 847,
        },
        AgentEntry {
            pubkey: [1u8; 32],
            reputation: 612,
        },
        AgentEntry {
            pubkey: [2u8; 32],
            reputation: 423,
        },
        AgentEntry {
            pubkey: [3u8; 32],
            reputation: 750,
        },
    ]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    dotenv().ok();
    let args: Vec<String> = env::args().collect();
    let agent_pubkey_hex = args.get(1).expect("Usage: prove <AGENT_PUBKEY_HEX> <THRESHOLD>");
    let threshold: u64 = args
        .get(2)
        .expect("provide threshold")
        .parse()
        .expect("threshold must be u64");

    let rpc_url = env::var("SOLANA_RPC")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());

    // Parse target agent pubkey
    let pubkey_bytes = hex::decode(agent_pubkey_hex.trim_start_matches("0x"))
        .expect("invalid hex pubkey");
    let mut agent_pubkey = [0u8; 32];
    agent_pubkey[..pubkey_bytes.len().min(32)]
        .copy_from_slice(&pubkey_bytes[..pubkey_bytes.len().min(32)]);

    // Fetch registry
    let agents = fetch_agents_from_devnet(&rpc_url, &agent_pubkey);
    let target_idx = agents
        .iter()
        .position(|a| a.pubkey == agent_pubkey)
        .expect("agent not found in registry");
    let target = &agents[target_idx];

    // Build merkle tree
    let leaves: Vec<[u8; 32]> = agents
        .iter()
        .map(|a| hash_leaf(&a.pubkey, a.reputation))
        .collect();
    let tree = build_merkle_tree(&leaves);
    let merkle_root = tree.last().unwrap()[0];
    let merkle_proof = generate_proof(&tree, target_idx);

    println!(
        "Merkle root: {}",
        hex::encode(merkle_root)
    );
    println!("Agent reputation: {}", target.reputation);

    // ---------------------------------------------------------------------------
    // SP1 proof generation
    // ---------------------------------------------------------------------------
    let elf = include_bytes!("../../program/elf/sp1-reputation-program");

    let mut stdin = SP1Stdin::new();
    // Private inputs
    stdin.write(&agent_pubkey);
    stdin.write(&target.reputation);
    stdin.write(&0u64); // total_jobs (not verified, just passed)
    stdin.write(&merkle_proof);
    // Public inputs
    stdin.write(&threshold);
    stdin.write(&merkle_root);

    let client = ProverClient::new();
    let (pk, vk) = client.setup(elf);

    println!("Generating Groth16 proof (this takes ~60 seconds)...");
    let proof = client
        .prove(&pk, stdin)
        .groth16()
        .run()
        .expect("proof generation failed");

    // Decode public values
    let mut pub_vals = proof.public_values.as_slice();
    let is_qualified: bool = sp1_sdk::SP1PublicValues::read::<bool>(&mut pub_vals);
    let tier: u8 = sp1_sdk::SP1PublicValues::read::<u8>(&mut pub_vals);

    let output = ProofOutput {
        proof: hex::encode(proof.bytes()),
        public_values: hex::encode(proof.public_values.as_slice()),
        is_qualified,
        reputation_tier: tier,
        merkle_root: hex::encode(merkle_root),
        agent_pubkey: hex::encode(agent_pubkey),
        threshold,
    };

    std::fs::write(
        "proof_output.json",
        serde_json::to_string_pretty(&output).unwrap(),
    )
    .unwrap();

    println!("✅ Proof saved to proof_output.json");
    println!("   is_qualified={} tier={}", is_qualified, tier);
}
