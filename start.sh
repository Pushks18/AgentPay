#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo ""
echo "  ██████╗  ██████╗ ███████╗███╗   ██╗████████╗██████╗  █████╗ ██╗   ██╗"
echo "  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗╚██╗ ██╔╝"
echo "  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██████╔╝███████║ ╚████╔╝ "
echo "  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██╔═══╝ ██╔══██║  ╚██╔╝  "
echo "  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║     ██║  ██║   ██║   "
echo "  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝     ╚═╝  ╚═╝   ╚═╝  "
echo ""
echo "  Dual-chain agent economy — Solana + Avalanche"
echo ""

# ─── Activate venv ──────────────────────────────────────────────────────────
if [ ! -f ".venv/bin/activate" ]; then
  echo "❌ .venv not found. Run: python3 -m venv .venv && pip install -r requirements.txt"
  exit 1
fi
source .venv/bin/activate

# ─── Kill any previous processes on our ports ──────────────────────────────
for PORT in 8001 8002; do
  PID=$(lsof -ti tcp:$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "  Stopping existing process on port $PORT (PID $PID)…"
    kill "$PID" 2>/dev/null || true
    sleep 0.5
  fi
done

# ─── Agent B — Avalanche Fuji (port 8001) ───────────────────────────────────
echo "  Starting Agent B (Fuji) on :8001…"
.venv/bin/uvicorn agent_b.main:app_fuji --port 8001 --log-level warning > /tmp/agentpay_b_fuji.log 2>&1 &
FUJI_PID=$!
echo "  ✅ Agent B Fuji   PID=$FUJI_PID  logs → /tmp/agentpay_b_fuji.log"

# ─── Agent B — Solana devnet (port 8002) ────────────────────────────────────
echo "  Starting Agent B (Solana) on :8002…"
.venv/bin/uvicorn agent_b.main:app_sol --port 8002 --log-level warning > /tmp/agentpay_b_sol.log 2>&1 &
SOL_PID=$!
echo "  ✅ Agent B Solana  PID=$SOL_PID  logs → /tmp/agentpay_b_sol.log"

# ─── Wait for Agent B to be ready ───────────────────────────────────────────
echo ""
echo "  Waiting for Agent B to come up…"
for i in $(seq 1 15); do
  if curl -sf http://localhost:8001/healthz > /dev/null 2>&1; then
    echo "  ✅ Agent B Fuji  ready"
    break
  fi
  sleep 1
done
for i in $(seq 1 10); do
  if curl -sf http://localhost:8002/healthz > /dev/null 2>&1; then
    echo "  ✅ Agent B Solana ready"
    break
  fi
  sleep 1
done

# ─── Dashboard (Next.js + WS relay on port 3000 + 3001) ─────────────────────
echo ""
echo "  Starting dashboard (Next.js + WebSocket relay)…"
cd "$ROOT/dashboard"
npm run dev > /tmp/agentpay_dashboard.log 2>&1 &
DASH_PID=$!
echo "  ✅ Dashboard      PID=$DASH_PID  logs → /tmp/agentpay_dashboard.log"

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║  🚀  AgentPay is running!                        ║"
echo "  ╠══════════════════════════════════════════════════╣"
echo "  ║  Dashboard      →  http://localhost:3000         ║"
echo "  ║  Agent B Fuji   →  http://localhost:8001         ║"
echo "  ║  Agent B Solana →  http://localhost:8002         ║"
echo "  ║  WebSocket      →  ws://localhost:3001           ║"
echo "  ╠══════════════════════════════════════════════════╣"
echo "  ║  Logs:                                           ║"
echo "  ║    tail -f /tmp/agentpay_b_fuji.log              ║"
echo "  ║    tail -f /tmp/agentpay_b_sol.log               ║"
echo "  ║    tail -f /tmp/agentpay_dashboard.log           ║"
echo "  ╠══════════════════════════════════════════════════╣"
echo "  ║  Press Ctrl+C to stop all services               ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo ""

# ─── Cleanup on exit ────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "  Stopping all services…"
  kill "$FUJI_PID" "$SOL_PID" "$DASH_PID" 2>/dev/null || true
  echo "  ✅ All stopped."
}
trap cleanup EXIT INT TERM

# Keep running until Ctrl+C
wait
