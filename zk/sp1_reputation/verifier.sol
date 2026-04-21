// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AgentPay Reputation Verifier
/// @notice Verifies an SP1 ZK proof that an agent's reputation >= threshold.
///         Deployed on Avalanche Fuji. Agent A calls this before hiring
///         an unknown agent cross-chain from Solana.

interface ISP1Verifier {
    function verifyProof(
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external view;
}

contract AgentPayReputationVerifier {
    // SP1 Verifier deployed on Fuji by Succinct Labs.
    // Replace with official address from https://docs.succinct.xyz/onchain-verification/overview
    address public constant SP1_VERIFIER_FUJI =
        0x3B6041173B80E77f038f3F2C0f9744f04837185e;

    // Verification key hash for the sp1-reputation-program ELF.
    // Replace after `cargo prove build` prints the vkey hash.
    bytes32 public constant VKEY_HASH = bytes32(0);

    ISP1Verifier private immutable sp1Verifier;

    event ReputationVerified(
        address indexed caller,
        bool isQualified,
        uint8 reputationTier,
        bytes32 merkleRoot
    );

    constructor() {
        sp1Verifier = ISP1Verifier(SP1_VERIFIER_FUJI);
    }

    /// @notice Verify an SP1 reputation proof.
    /// @param proof       The SP1 proof bytes (from proof_output.json `.proof`).
    /// @param publicValues The public values bytes (from proof_output.json `.public_values`).
    /// @return isQualified   True if agent reputation >= threshold.
    /// @return reputationTier 0=bronze, 1=silver, 2=gold.
    function verifyReputationProof(
        bytes calldata proof,
        bytes calldata publicValues
    ) external view returns (bool isQualified, uint8 reputationTier) {
        // Will revert if proof is invalid.
        sp1Verifier.verifyProof(VKEY_HASH, publicValues, proof);

        // Decode committed public outputs:
        // layout: bool(1) + uint8(1) + bytes32(32) = 34 bytes
        require(publicValues.length >= 34, "short public values");
        isQualified = publicValues[0] != 0;
        reputationTier = uint8(publicValues[1]);

        return (isQualified, reputationTier);
    }

    /// @notice Convenience wrapper that also emits an event.
    function verifyAndRecord(
        bytes calldata proof,
        bytes calldata publicValues
    ) external returns (bool isQualified, uint8 reputationTier) {
        (isQualified, reputationTier) = this.verifyReputationProof(proof, publicValues);

        bytes32 merkleRoot;
        assembly {
            merkleRoot := calldataload(add(publicValues.offset, 2))
        }

        emit ReputationVerified(msg.sender, isQualified, reputationTier, merkleRoot);
    }
}
