pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

/// Sealed-bid auction circuit.
///
/// Private inputs:
///   bid_amount      — the bidder's actual bid in USDC micro-units
///   bidder_secret   — random salt to prevent brute-force of commitment
///
/// Public inputs:
///   bid_commitment     — Poseidon(bid_amount, bidder_secret)  stored on-chain
///   winning_commitment — commitment of the winning bid (revealed at close)
///   max_budget         — job budget ceiling
///
/// Constraints:
///   1. commitment == Poseidon(bid_amount, bidder_secret)
///   2. commitment == winning_commitment   (this prover is the winner)
///   3. bid_amount <= max_budget
///   4. bid_amount > 0

template SealedBid() {
    // --- Private inputs ---
    signal input bid_amount;
    signal input bidder_secret;

    // --- Public inputs ---
    signal input bid_commitment;
    signal input winning_commitment;
    signal input max_budget;

    // --- Output ---
    signal output revealed_amount;

    // 1. Compute Poseidon commitment
    component hasher = Poseidon(2);
    hasher.inputs[0] <== bid_amount;
    hasher.inputs[1] <== bidder_secret;

    // 2. Commitment matches what was stored on-chain
    hasher.out === bid_commitment;

    // 3. This bidder is the winner
    bid_commitment === winning_commitment;

    // 4. bid_amount <= max_budget
    component le = LessEqThan(64);
    le.in[0] <== bid_amount;
    le.in[1] <== max_budget;
    le.out === 1;

    // 5. bid_amount > 0
    component gt = GreaterThan(64);
    gt.in[0] <== bid_amount;
    gt.in[1] <== 0;
    gt.out === 1;

    // Reveal winning bid
    revealed_amount <== bid_amount;
}

component main {public [bid_commitment, winning_commitment, max_budget]} = SealedBid();
