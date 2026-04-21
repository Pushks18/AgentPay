#!/bin/bash
set -e

echo "=================================================="
echo "  AgentPay — Wallet & Dependency Setup"
echo "=================================================="

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

# ---------------------------------------------------------------------------
# Create directories
# ---------------------------------------------------------------------------
mkdir -p "$ROOT/programs/agent-registry/src"
mkdir -p "$ROOT/programs/escrow/src"
mkdir -p "$ROOT/programs/staking/src"
mkdir -p "$ROOT/agent_a/tools"
mkdir -p "$ROOT/agent_b/services"
mkdir -p "$ROOT/zk/sp1_reputation/program/src"
mkdir -p "$ROOT/zk/sp1_reputation/script/src"
mkdir -p "$ROOT/zk/private_bid"
mkdir -p "$ROOT/scripts"

# ---------------------------------------------------------------------------
# Check required tools
# ---------------------------------------------------------------------------
echo ""
echo "Checking prerequisites..."

check_tool() {
  if ! command -v "$1" &>/dev/null; then
    echo "  ❌ $1 not found — install it first"
    exit 1
  else
    echo "  ✅ $1 $(\"$1\" --version 2>&1 | head -1)"
  fi
}

check_tool cast
check_tool solana
check_tool anchor
check_tool node
check_tool python3

# ---------------------------------------------------------------------------
# Generate EVM wallets
# ---------------------------------------------------------------------------
echo ""
echo "Generating EVM wallets..."

EVM_A=$(cast wallet new 2>&1)
EVM_B=$(cast wallet new 2>&1)

AGENT_A_EVM_ADDRESS=$(echo "$EVM_A" | grep "Address:" | awk '{print $2}')
AGENT_A_EVM_PRIVATE_KEY=$(echo "$EVM_A" | grep "Private key:" | awk '{print $3}')
AGENT_B_EVM_ADDRESS=$(echo "$EVM_B" | grep "Address:" | awk '{print $2}')
AGENT_B_EVM_PRIVATE_KEY=$(echo "$EVM_B" | grep "Private key:" | awk '{print $3}')

echo "  Agent A EVM: $AGENT_A_EVM_ADDRESS"
echo "  Agent B EVM: $AGENT_B_EVM_ADDRESS"

# ---------------------------------------------------------------------------
# Generate Solana wallets
# ---------------------------------------------------------------------------
echo ""
echo "Generating Solana wallets..."

solana-keygen new --outfile "$ROOT/agent_a_sol.json" --no-bip39-passphrase --force -s
solana-keygen new --outfile "$ROOT/agent_b_sol.json" --no-bip39-passphrase --force -s
solana-keygen new --outfile "$ROOT/agent_c_sol.json" --no-bip39-passphrase --force -s

AGENT_A_SOL=$(solana address --keypair "$ROOT/agent_a_sol.json")
AGENT_B_SOL=$(solana address --keypair "$ROOT/agent_b_sol.json")
AGENT_C_SOL=$(solana address --keypair "$ROOT/agent_c_sol.json")

# Convert keypairs to bs58 for .env
AGENT_A_SOL_BS58=$(python3 -c "
import json, base58
kp = json.load(open('$ROOT/agent_a_sol.json'))
print(base58.b58encode(bytes(kp)).decode())
")
AGENT_B_SOL_BS58=$(python3 -c "
import json, base58
kp = json.load(open('$ROOT/agent_b_sol.json'))
print(base58.b58encode(bytes(kp)).decode())
")
AGENT_C_SOL_BS58=$(python3 -c "
import json, base58
kp = json.load(open('$ROOT/agent_c_sol.json'))
print(base58.b58encode(bytes(kp)).decode())
")

echo "  Agent A Solana: $AGENT_A_SOL"
echo "  Agent B Solana: $AGENT_B_SOL"
echo "  Agent C Solana: $AGENT_C_SOL"

# ---------------------------------------------------------------------------
# Write .env
# ---------------------------------------------------------------------------
echo ""
echo "Writing .env..."

cat > "$ENV_FILE" <<ENVEOF
# AI
OPENAI_API_KEY=sk-REPLACE_ME

# Solana
HELIUS_API_KEY=REPLACE_ME
AGENT_A_SOL_PRIVATE_KEY_BS58=$AGENT_A_SOL_BS58
AGENT_B_SOL_PRIVATE_KEY_BS58=$AGENT_B_SOL_BS58
AGENT_C_SOL_PRIVATE_KEY_BS58=$AGENT_C_SOL_BS58
USDC_DEVNET_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
SOLANA_RPC=https://devnet.helius-rpc.com/?api-key=REPLACE_ME
REPUTATION_MINT=
AGENT_REGISTRY_PROGRAM_ID=
ESCROW_PROGRAM_ID=
STAKING_PROGRAM_ID=

# Solana — for ZK script
SOL_PAYER_BS58=$AGENT_A_SOL_BS58

# Avalanche
AGENT_A_EVM_PRIVATE_KEY=$AGENT_A_EVM_PRIVATE_KEY
AGENT_B_EVM_PRIVATE_KEY=$AGENT_B_EVM_PRIVATE_KEY
AGENT_B_EVM_ADDRESS=$AGENT_B_EVM_ADDRESS
AGENT_B_SOLANA_ADDRESS=$AGENT_B_SOL
FUJI_RPC=https://api.avax-test.network/ext/bc/C/rpc
USDC_FUJI=0x5425890298aed601595a70AB815c96711a31Bc65
ERC8004_IDENTITY=0x8004A818BFB912233c491871b3d84c89A494BD9e
ERC8004_REPUTATION=0x8004B663056A597Dffe9eCcC1965A193B7388713
X402_FACILITATOR=https://x402.org/facilitator
PAYAI_FACILITATOR=https://facilitator.payai.network

# App
AGENT_B_FUJI_URL=http://localhost:8001
AGENT_B_SOL_URL=http://localhost:8002
NEXT_PUBLIC_WS_URL=ws://localhost:3001
ENVEOF

echo "  ✅ .env written"

# ---------------------------------------------------------------------------
# Install Python deps in venv
# ---------------------------------------------------------------------------
echo ""
echo "Setting up Python venv..."

if [ ! -d "$ROOT/.venv" ]; then
  python3 -m venv "$ROOT/.venv"
fi
"$ROOT/.venv/bin/pip" install -q --upgrade pip
"$ROOT/.venv/bin/pip" install -q -r "$ROOT/requirements.txt"
echo "  ✅ Python deps installed"

# ---------------------------------------------------------------------------
# Install ZK reputation npm deps
# ---------------------------------------------------------------------------
echo ""
echo "Installing ZK reputation npm deps..."
cd "$ROOT/agent_b" && npm install --save \
  @lightprotocol/stateless.js \
  @lightprotocol/compressed-token \
  @solana/web3.js \
  bs58 \
  dotenv 2>/dev/null || true

# ---------------------------------------------------------------------------
# Print funding instructions
# ---------------------------------------------------------------------------
echo ""
echo "=================================================="
echo "  FUND THESE WALLETS BEFORE RUNNING ANYTHING"
echo "=================================================="
echo ""
echo "  Agent A EVM: $AGENT_A_EVM_ADDRESS"
echo "    → 0.2 AVAX  : https://core.app/tools/testnet-faucet/"
echo "    → 0.1 USDC  : https://faucet.circle.com (Avalanche Fuji)"
echo ""
echo "  Agent B EVM: $AGENT_B_EVM_ADDRESS"
echo "    → 0.2 AVAX  : https://core.app/tools/testnet-faucet/"
echo ""
echo "  Agent A Solana: $AGENT_A_SOL"
echo "    → 2 SOL     : solana airdrop 2 --keypair agent_a_sol.json"
echo "    → 0.1 USDC  : https://faucet.circle.com (Solana Devnet)"
echo ""
echo "  Agent B Solana: $AGENT_B_SOL"
echo "    → 2 SOL     : solana airdrop 2 --keypair agent_b_sol.json"
echo ""
echo "  Agent C Solana (arbitrator): $AGENT_C_SOL"
echo "    → 1 SOL     : solana airdrop 1 --keypair agent_c_sol.json"
echo ""
echo "  ALSO:"
echo "    1. Fill OPENAI_API_KEY and HELIUS_API_KEY in .env"
echo "    2. Run: cd agent_b && node zk_reputation.mjs init"
echo "    3. Add REPUTATION_MINT= from that output to .env"
echo ""
echo "Then: anchor build && anchor deploy"
echo "=================================================="
