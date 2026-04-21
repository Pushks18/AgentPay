# AgentPay — The On-Chain Agent Economy

> *The payments and reputation fabric for a billion AI agents.*

## Demo video
[https://youtu.be/oUCDaHR83GM]

---

## What it does

AI agents are about to outnumber humans on the internet, and they need a real economy — not database rows pretending to be payments. AgentPay is that economy: autonomous AI agents discover each other on-chain, negotiate prices, lock USDC in Rust escrow contracts, do verifiable work, and build ZK-portable reputation — with zero human clicks on the critical path.

The "wow moment" is at the 35-second mark of the demo video: USDC moves on Snowtrace with no human involved. Agent A autonomously hired Agent B, paid $0.005 USDC, received a trust report, released escrow, and minted a ZK-compressed reputation token on Solana — all in under 30 seconds.

AgentPay uses **specialization**, not hedging. Solana hosts identity and reputation because Light Protocol's ZK-compressed tokens make a million-agent economy economically feasible ($0.00001 per mint vs $0.01 for SPL). Avalanche hosts settlement because sub-second finality and EIP-3009 gasless USDC make micropayments practical. Each chain does what it is genuinely best at.

---

## How the 30-second loop works

1. `python -m agent_a.main "Trust report for 0xABC"` starts Agent A
2. Agent A calls `discover_agents(service="trust_report")` — reads live Anchor PDAs on Solana + ERC-8004 on Fuji
3. Picks cheapest agent with reputation ≥ 0.8 (sort by price_usd)
4. Creates on-chain escrow: USDC locked in Rust PDA on Solana
5. Calls `pay_and_fetch_solana_agent` — x402 HTTP payment + trust report response
6. USDC transfer lands on Solana Explorer in ~1 second
7. `release_escrow` — USDC flows from PDA to Agent B's wallet
8. `write_reputation_evm` — ERC-8004 `giveFeedback` on Avalanche Fuji (tx on Snowtrace)
9. `write_reputation_solana` — Light Protocol mints 1 ZK-compressed reputation token
10. Dashboard at localhost:3000 shows animated payment pulse + job card

---

## Architecture

![AgentPay Architecture](./dashboard/public/architecture.svg)

## Tech stack

| Component | Technology | Why this chain/tool |
|---|---|---|
| Buyer agent | LangChain ReAct + LangGraph | Autonomous multi-step reasoning with parallel subtasks |
| Seller agent | FastAPI + x402 | HTTP-native payments; zero-config for LLM agents |
| Payment rail (EVM) | fastapi-x402 + EIP-3009 | Gasless USDC on Avalanche Fuji |
| Payment rail (Solana) | x402[svm] + PayAI facilitator | Solana USDC with SPL token transfers |
| Identity/Reputation (EVM) | ERC-8004 live registries on Fuji | Canonical standard, co-authored by Google/MetaMask/Coinbase |
| Agent registry (Solana) | Anchor program (Rust) | PDA-seeded agent cards, composable |
| Escrow | Anchor SPL token program | On-chain payment lock, auto-release, dispute resolution |
| Staking/Slashing | Anchor program | Stake SOL to register; 3 slash votes = stake burned |
| ZK reputation | Light Protocol compressed tokens + SP1 | ~200× cheaper than SPL; validity-proven canonical state |
| ZK proof (cross-chain) | SP1 zkVM + Groth16 | Proves Solana reputation on Avalanche without revealing identity |
| Sealed bid | Circom + snarkjs | Private auction prevents front-running |
| Dashboard | Next.js 14 + D3 + framer-motion | Real-time force graph with animated payment pulses |
| RPC | Helius devnet (Light Protocol Photon) | Required for ZK-compressed token indexing |
| USDC | Circle-issued native (both chains) | Non-wrapped, EIP-3009, CCTP-ready |

---

## ZK proof explanation

**SP1 reputation proof**: Agent A can verify that Agent B has reputation ≥ 500 on Solana *before* hiring them cross-chain, without Agent B revealing which account they are or their full history. The SP1 zkVM executes a merkle inclusion proof (agent is in registry tree) plus a threshold check. The resulting Groth16 proof is verified by a Solidity contract on Avalanche Fuji. Result: privacy-preserving, cross-chain reputation portability.

**Sealed-bid auction**: Multiple agents bid for a job. A Circom circuit proves a bidder won without revealing losing bids — prevents front-running and collusion between agents.

---

## Rust programs (Solana Anchor)

| Program | What it does | Program ID |
|---|---|---|
| `agent-registry` | Register/deregister agents, PDA per agent | `AgReg11...` (fill after deploy) |
| `escrow` | Lock USDC, release to seller or refund buyer, dispute arbitration | `Escrow1...` |
| `staking` | Stake SOL to register; 3 slash votes = stake burned, agent deactivated | `Stake1...` |

---

## Track submissions {#solana-track}

### Solana track — Best Use of Solana

AgentPay gives Solana its first production-grade agent economy primitive. The Anchor `agent-registry` stores agent cards in PDA-seeded accounts with service type filtering via `get_program_accounts`. The `escrow` program locks Circle-issued USDC and auto-releases after job completion — no human intervention. The `staking` program gives agents skin in the game: stake 0.1 SOL, get slashed if 3 buyers vote bad work, stake burned forever. And above all: Light Protocol ZK-compressed reputation tokens are the only credible path to reputation for a million agents — SPL rent alone ($0.01/account × 1M agents = $10K) is prohibitive. Light Protocol brings that to ~$50. That is why Solana is the trust layer.

### Avalanche track — Agentic Payments on Avalanche {#avalanche-track}

Avalanche's sub-second finality and fractional-cent fees make it the only place where an AI agent can pay another agent $0.01 a hundred times a minute. AgentPay implements **ERC-8004** — the identity standard co-authored by the Ethereum Foundation, Google, MetaMask, and Coinbase — natively on Fuji against the live registries. Payments flow through `fastapi-x402` with Circle USDC (`0x5425…Bc65`), settled via EIP-3009 `transferWithAuthorization` in one second. Architecture is Teleporter-ready — the same identity pattern ports to any Avalanche L1.

### Circle track — Programmable Money for Humans & Agents {#circle-track}

Native Circle-issued USDC on both chains is the settlement asset for every AgentPay transaction. On Avalanche Fuji (`0x5425890298aed601595a70AB815c96711a31Bc65`), EIP-3009 `transferWithAuthorization` makes payments gasless for the buyer. On Solana devnet (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), Circle USDC flows through SPL token transfers inside the Anchor escrow. Architecture is CCTP-ready — adding cross-chain USDC flows between Avalanche and Solana requires only a single bridge call.

---

## Running locally

```bash
# 1. Clone and enter the repo
git clone https://github.com/YOUR_USERNAME/agentpay
cd agentpay

# 2. Generate wallets and install deps
chmod +x scripts/setup_wallets.sh
./scripts/setup_wallets.sh

# 3. Fill in .env (OPENAI_API_KEY, HELIUS_API_KEY, fund wallets)

# 4. Build and deploy Anchor programs
anchor keys sync
anchor build
anchor deploy --provider.cluster devnet
# → save Program IDs to .env

# 5. Init ZK reputation mint
cd agent_b && node zk_reputation.mjs init
# → add REPUTATION_MINT= to .env

# 6. Register agents on-chain
cd .. && npx ts-node scripts/register_agents.ts

# 7. Seed reputation data
npx ts-node scripts/seed_reputation.ts

# 8. Start Agent B (two terminals)
.venv/bin/uvicorn agent_b.main:app_fuji --port 8001
.venv/bin/uvicorn agent_b.main:app_sol --port 8002

# 9. Run Agent A end-to-end
.venv/bin/python -m agent_a.main "Trust report for 0xABCDEF1234"

# 10. Start dashboard
cd dashboard && npm install && npm run dev
# → open localhost:3000
```

---

## Gotchas and known issues

- **Render cold starts**: free plan sleeps after 15min idle. Hit `/healthz` every 30s during judging.
- **Solana x402 facilitator**: PayAI's facilitator at `https://facilitator.payai.network` may have testnet latency. If it times out, re-run — don't switch facilitators mid-demo.
- **ERC-8004 self-feedback revert**: Agent A and Agent B **must** use different EVM wallets. The ReputationRegistry checks identity and reverts if you rate yourself.
- **Anchor IDL drift**: always run `anchor keys sync` before `anchor build` after any program ID change. Copy fresh `target/idl/*.json` after every rebuild.
- **Light Protocol + Helius**: compressed tokens require the Helius RPC, not public devnet. Always use `SOLANA_RPC` from `.env`.
- **SP1 nightly Rust**: run `rustup override set nightly` in `zk/sp1_reputation/` before building.

---

*Built solo in 7 hours for SCBC 2026. Public repo, live demo, real money moving.*
