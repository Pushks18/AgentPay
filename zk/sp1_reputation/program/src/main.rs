//! SP1 guest program: proves an agent has reputation >= threshold
//! without revealing the agent's identity or full history.
//!
//! Run `rustup override set nightly` in this directory before building.

#![no_main]
sp1_zkvm::entrypoint!(main);

use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// Merkle helpers
// ---------------------------------------------------------------------------

fn hash_leaf(pubkey: &[u8; 32], score: u64) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(pubkey);
    hasher.update(score.to_le_bytes());
    hasher.finalize().into()
}

fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    if left <= right {
        hasher.update(left);
        hasher.update(right);
    } else {
        hasher.update(right);
        hasher.update(left);
    }
    hasher.finalize().into()
}

fn verify_merkle_proof(
    leaf: &[u8; 32],
    proof: &[[u8; 32]],
    root: &[u8; 32],
) -> bool {
    let mut current = *leaf;
    for sibling in proof {
        current = hash_pair(&current, sibling);
    }
    &current == root
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

pub fn main() {
    // --- Private inputs (not revealed in the proof) ---
    let agent_pubkey: [u8; 32] = sp1_zkvm::io::read();
    let reputation_score: u64 = sp1_zkvm::io::read();
    let _total_jobs: u64 = sp1_zkvm::io::read();
    let merkle_proof: Vec<[u8; 32]> = sp1_zkvm::io::read();

    // --- Public inputs (visible to verifier) ---
    let reputation_threshold: u64 = sp1_zkvm::io::read();
    let merkle_root: [u8; 32] = sp1_zkvm::io::read();

    // 1. Verify the agent is actually in the registry merkle tree.
    let leaf = hash_leaf(&agent_pubkey, reputation_score);
    let proof_valid = verify_merkle_proof(&leaf, &merkle_proof, &merkle_root);
    assert!(proof_valid, "Invalid merkle proof: agent not in registry");

    // 2. Check threshold.
    let is_qualified = reputation_score >= reputation_threshold;

    // 3. Tier classification (0=bronze <500, 1=silver 500-749, 2=gold >=750).
    let reputation_tier: u8 = if reputation_score >= 750 {
        2
    } else if reputation_score >= 500 {
        1
    } else {
        0
    };

    // --- Public outputs (committed into the proof) ---
    sp1_zkvm::io::commit(&is_qualified);
    sp1_zkvm::io::commit(&reputation_tier);
    sp1_zkvm::io::commit(&merkle_root);
}
