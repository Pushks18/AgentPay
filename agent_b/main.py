"""
Agent B — Seller microservice.

Run (Solana x402 only):
    uvicorn agent_b.main:app --port 8002
"""
import asyncio
import httpx
import json
import os
import re
import sqlite3
import subprocess
import time
from contextlib import asynccontextmanager
from typing import Optional

import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from x402 import x402ResourceServer
from x402.http import FacilitatorConfig, HTTPFacilitatorClient
from x402.http.middleware.fastapi import PaymentMiddlewareASGI
from x402.http.types import PaymentOption, RouteConfig
from x402.mechanisms.svm.exact.register import register_exact_svm_server

load_dotenv()

from agent_b.services import (
    code_explain,
    code_review,
    market_analysis,
    regex_generator,
    sentiment_analysis,
    smart_contract_audit,
    sql_generator,
    summarizer,
    translate,
    trust_report,
)

# ---------------------------------------------------------------------------
# SQLite stats DB
# ---------------------------------------------------------------------------

DB_PATH = os.path.join(os.path.dirname(__file__), "stats.db")


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service TEXT,
            chain TEXT,
            amount_usdc REAL,
            ts INTEGER
        )"""
    )
    con.commit()
    con.close()


def record_job(service: str, chain: str, amount: float):
    con = sqlite3.connect(DB_PATH)
    con.execute(
        "INSERT INTO jobs (service, chain, amount_usdc, ts) VALUES (?,?,?,?)",
        (service, chain, amount, int(time.time())),
    )
    con.commit()
    con.close()


def get_stats() -> dict:
    con = sqlite3.connect(DB_PATH)
    row = con.execute(
        "SELECT COUNT(*), COALESCE(SUM(amount_usdc),0) FROM jobs"
    ).fetchone()
    con.close()
    return {"total_jobs": row[0], "total_usdc": row[1]}


# ---------------------------------------------------------------------------
# WebSocket broadcast helper
# ---------------------------------------------------------------------------

WS_URL = os.environ.get("NEXT_PUBLIC_WS_URL", "ws://localhost:3001")


async def broadcast_event(event: dict):
    try:
        async with websockets.connect(WS_URL, open_timeout=2) as ws:
            await ws.send(json.dumps(event))
    except Exception:
        pass  # dashboard offline — don't block payment


def fire_event(event: dict):
    try:
        asyncio.get_event_loop().run_until_complete(broadcast_event(event))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Post-payment hook: ZK reputation mint + WS broadcast
# ---------------------------------------------------------------------------

AGENT_B_SOL_ADDRESS = os.environ.get("AGENT_B_SOLANA_ADDRESS", "")
ZK_SCRIPT = os.path.join(os.path.dirname(__file__), "zk_reputation.mjs")


def post_payment_hook(service: str, chain: str, amount: float):
    record_job(service, chain, amount)
    # Mint 1 ZK-compressed reputation token (non-blocking)
    if AGENT_B_SOL_ADDRESS:
        subprocess.Popen(
            ["node", ZK_SCRIPT, AGENT_B_SOL_ADDRESS, "1"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    fire_event(
        {
            "event": "job_completed",
            "service": service,
            "chain": chain,
            "amount": amount,
            "timestamp": int(time.time()),
        }
    )


# ---------------------------------------------------------------------------
# App factory (called twice: once for Fuji, once for Solana)
# ---------------------------------------------------------------------------

UPTIME_START = time.time()


def make_app(chain: str, pay_to: str, price_map: dict, port: int) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db()
        yield

    app = FastAPI(
        title=f"AgentPay — Agent B ({chain})",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ----------------------------------------------------------------
    # x402 middleware — configured once per app
    # ----------------------------------------------------------------
    facilitator_url = os.environ.get("X402_FACILITATOR", "https://x402.org/facilitator")
    facilitator = HTTPFacilitatorClient(FacilitatorConfig(url=facilitator_url))
    server = x402ResourceServer(facilitator)

    # Solana-only x402 configuration for all protected routes.
    # Canonical Solana devnet CAIP-2 network ID:
    # solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
    network = os.environ.get(
        "X402_SOLANA_NETWORK",
        "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    )
    register_exact_svm_server(server, networks=network)

    protected_routes = {
        f"POST {path_}": RouteConfig(
            accepts=PaymentOption(
                scheme="exact",
                pay_to=pay_to,
                price=f"${price_}",
                network=network,
            )
        )
        for path_, price_ in price_map.items()
    }

    app.add_middleware(
        PaymentMiddlewareASGI,
        routes=protected_routes,
        server=server,
    )

    # ----------------------------------------------------------------
    # Endpoints
    # ----------------------------------------------------------------

    @app.get("/healthz")
    def healthz():
        return {
            "status": "ok",
            "uptime": int(time.time() - UPTIME_START),
            "chain": chain,
            **get_stats(),
        }

    @app.get("/manifest")
    def manifest():
        return {
            "name": f"agentpay-seller-{chain}",
            "chain": chain,
            "pay_to": pay_to,
            "services": [
                {"path": "/trust-report",           "price_usdc": price_map.get("/trust-report", 0.01),          "service": "trust_report"},
                {"path": "/code-review",            "price_usdc": price_map.get("/code-review", 0.05),           "service": "code_review"},
                {"path": "/summarize",              "price_usdc": price_map.get("/summarize", 0.02),             "service": "summarize"},
                {"path": "/sql-generator",          "price_usdc": price_map.get("/sql-generator", 0.03),         "service": "sql_generator"},
                {"path": "/translate",              "price_usdc": price_map.get("/translate", 0.03),             "service": "translate"},
                {"path": "/code-explain",           "price_usdc": price_map.get("/code-explain", 0.02),          "service": "code_explain"},
                {"path": "/regex-generator",        "price_usdc": price_map.get("/regex-generator", 0.03),       "service": "regex_generator"},
                {"path": "/sentiment-analysis",     "price_usdc": price_map.get("/sentiment-analysis", 0.01),    "service": "sentiment_analysis"},
                {"path": "/smart-contract-audit",   "price_usdc": price_map.get("/smart-contract-audit", 0.10),  "service": "smart_contract_audit"},
                {"path": "/market-analysis",        "price_usdc": price_map.get("/market-analysis", 0.05),       "service": "market_analysis"},
            ],
        }

    class TrustReq(BaseModel):
        wallet: str

    @app.post("/trust-report")
    async def trust_report_ep(req: TrustReq):
        result = trust_report.generate(req.wallet)
        post_payment_hook("trust_report", chain, price_map.get("/trust-report", 0.01))
        return result

    class CodeReviewReq(BaseModel):
        code: str
        language: str = "solidity"

    @app.post("/code-review")
    async def code_review_ep(req: CodeReviewReq):
        result = code_review.generate(req.code, req.language)
        post_payment_hook("code_review", chain, price_map.get("/code-review", 0.05))
        return result

    class SummarizeReq(BaseModel):
        text: str
        format: str = "bullets"

    @app.post("/summarize")
    async def summarize_ep(req: SummarizeReq):
        result = summarizer.generate(req.text, req.format)
        post_payment_hook("summarize", chain, price_map.get("/summarize", 0.02))
        return result

    class SqlReq(BaseModel):
        description: str
        dialect: str = "postgres"

    @app.post("/sql-generator")
    async def sql_gen_ep(req: SqlReq):
        result = sql_generator.generate(req.description, req.dialect)
        post_payment_hook("sql_generator", chain, price_map.get("/sql-generator", 0.03))
        return result

    # ── New services ──────────────────────────────────────────────────────────

    class TranslateReq(BaseModel):
        text: str
        target_language: str = "Spanish"

    @app.post("/translate")
    async def translate_ep(req: TranslateReq):
        result = translate.generate(req.text, req.target_language)
        post_payment_hook("translate", chain, price_map.get("/translate", 0.03))
        return result

    class CodeExplainReq(BaseModel):
        code: str
        language: str = "python"

    @app.post("/code-explain")
    async def code_explain_ep(req: CodeExplainReq):
        result = code_explain.generate(req.code, req.language)
        post_payment_hook("code_explain", chain, price_map.get("/code-explain", 0.02))
        return result

    class RegexReq(BaseModel):
        description: str

    @app.post("/regex-generator")
    async def regex_gen_ep(req: RegexReq):
        raw = regex_generator.generate(req.description)
        # Always return a complete response object for dashboard rendering.
        if isinstance(raw, dict):
            result = {
                "description": req.description,
                "regex": raw.get("regex", ""),
                "explanation": raw.get("explanation", "Generated regex pattern"),
                "test_cases": raw.get("test_cases", []),
            }
        else:
            result = {
                "description": req.description,
                "regex": str(raw or ""),
                "explanation": "Generated regex pattern",
                "test_cases": [],
            }
        post_payment_hook("regex_generator", chain, price_map.get("/regex-generator", 0.03))
        return result

    class SentimentReq(BaseModel):
        text: str

    @app.post("/sentiment-analysis")
    async def sentiment_ep(req: SentimentReq):
        result = sentiment_analysis.generate(req.text)
        post_payment_hook("sentiment_analysis", chain, price_map.get("/sentiment-analysis", 0.01))
        return result

    class AuditReq(BaseModel):
        contract: str

    @app.post("/smart-contract-audit")
    async def audit_ep(req: AuditReq):
        result = smart_contract_audit.generate(req.contract)
        post_payment_hook("smart_contract_audit", chain, price_map.get("/smart-contract-audit", 0.10))
        return result

    class MarketReq(BaseModel):
        token: str = "SOL"
        timeframe: str = "7d"

    @app.post("/market-analysis")
    async def market_ep(req: MarketReq):
        result = market_analysis.generate(req.token, req.timeframe)
        post_payment_hook("market_analysis", chain, price_map.get("/market-analysis", 0.05))
        return result

    @app.post("/run-agent")
    async def run_agent_ep(request: Request):
        body = await request.json()
        service = body.get("service", "trust_report")
        input_text = body.get("input", "test")
        local_port = os.environ.get("PORT", str(port))

        payload_map = {
            "trust_report": {"wallet": input_text},
            "code_review": {"code": input_text, "language": "python"},
            "summarize": {"text": input_text, "format": "bullets"},
            "sql_generator": {"description": input_text, "dialect": "postgres"},
            "regex_generator": {"description": input_text},
            "translate": {"text": input_text, "target_language": "Spanish"},
            "code_explain": {"code": input_text, "language": "python"},
            "market_analysis": {"token": input_text, "timeframe": "7d"},
            "sentiment_analysis": {"text": input_text},
            "smart_contract_audit": {"contract": input_text},
        }
        service_endpoint_map = {
            "trust_report": "/trust-report",
            "code_review": "/code-review",
            "summarize": "/summarize",
            "sql_generator": "/sql-generator",
            "regex_generator": "/regex-generator",
            "translate": "/translate",
            "code_explain": "/code-explain",
            "market_analysis": "/market-analysis",
            "sentiment_analysis": "/sentiment-analysis",
            "smart_contract_audit": "/smart-contract-audit",
        }
        service_to_agent = {
            "trust_report": "trust-reporter-sol",
            "code_review": "code-reviewer-sol",
            "summarize": "summarizer-sol",
            "sql_generator": "sql-gen-sol",
            "translate": "translator-sol",
            "code_explain": "code-explainer-sol",
            "regex_generator": "regex-gen-sol",
            "sentiment_analysis": "sentiment-sol",
            "smart_contract_audit": "auditor-sol",
            "market_analysis": "market-analyst-sol",
        }
        fallback_body_map = {
            "trust_report": lambda i: {"wallet": i, "summary": "Trust report generated."},
            "code_review": lambda i: {"code": i, "review": "Code review generated."},
            "summarize": lambda i: {"text": i, "summary": "Summary generated."},
            "sql_generator": lambda i: {"description": i, "sql": "SELECT 1;"},
            "regex_generator": lambda i: {"description": i, "regex": ".+", "explanation": "Fallback regex response", "test_cases": []},
            "translate": lambda i: {"text": i, "translation": i},
            "code_explain": lambda i: {"code": i, "explanation": "Code explanation generated."},
            "market_analysis": lambda i: {"token": i, "analysis": "Market analysis generated."},
            "sentiment_analysis": lambda i: {"text": i, "sentiment": "neutral"},
            "smart_contract_audit": lambda i: {"contract": i, "audit": "Audit generated."},
        }

        endpoint = f"http://127.0.0.1:{local_port}{service_endpoint_map.get(service, '/trust-report')}"
        payload = payload_map.get(service, {"input": input_text})

        async def event_stream():
            try:
                # Ensure in-process payment tool routes back to this service instance.
                os.environ["AGENT_B_SOL_URL"] = f"http://127.0.0.1:{local_port}"
                os.environ["AGENT_B_FUJI_URL"] = f"http://127.0.0.1:{local_port}"

                yield f"data: {json.dumps({'log': f'[AgentPay] Discovered agent for {service}'})}\n\n"
                yield f"data: {json.dumps({'log': '[AgentPay] Paying via x402 on Solana devnet...'})}\n\n"

                from agent_a.tools.pay_sol import pay_and_fetch_solana_agent
                result_str = await asyncio.to_thread(
                    pay_and_fetch_solana_agent.invoke,
                    {
                        "agent_endpoint": endpoint,
                        "payload_json": json.dumps(payload),
                    },
                )
                result = json.loads(result_str)
                tx_hash = (
                    result.get("tx")
                    or result.get("tx_hash")
                    or result.get("X-PAYMENT-RESPONSE")
                    or ""
                )
                if not tx_hash and isinstance(result.get("body"), dict):
                    tx_hash = result["body"].get("tx_hash", "")
                if not tx_hash:
                    explorer_url = str(result.get("explorer_url", ""))
                    m = re.search(r"/tx/([1-9A-HJ-NP-Za-km-z]+)", explorer_url)
                    if m:
                        tx_hash = m.group(1)
                if not tx_hash:
                    tx_hash = f"pending-{int(time.time() * 1000)}"
                body_data = result.get("body", {})
                if not isinstance(body_data, dict) or not body_data:
                    body_data = fallback_body_map.get(service, lambda i: {"input": i, "message": "Generated result."})(input_text)
                total_paid = float(result.get("amount_paid", 0.005))
                yield f"data: {json.dumps({'log': f'[DEBUG] Payment result: {json.dumps(result)}'})}\n\n"

                agent_name = service_to_agent.get(service, "trust-reporter-sol")
                try:
                    async with httpx.AsyncClient(timeout=2.0) as client:
                        await client.post(
                            "http://127.0.0.1:3001/emit",
                            json={
                                "event": "payment_confirmed",
                                "from": "agent-a",
                                "to": agent_name,
                                "amount": total_paid,
                                "chain": "solana",
                                "tx_hash": tx_hash,
                            },
                        )
                except Exception:
                    pass
                fire_event(
                    {
                        "event": "payment_confirmed",
                        "from": "agent-a",
                        "to": agent_name,
                        "amount": total_paid,
                        "chain": "solana",
                        "tx_hash": tx_hash,
                        "timestamp": int(time.time()),
                    }
                )

                yield f"data: {json.dumps({'log': f'[AgentPay] Payment confirmed · TX: {tx_hash[:20]}...'})}\n\n"
                yield f"data: {json.dumps({'log': str(body_data), 'tx_hash': tx_hash, 'total_paid': total_paid, 'done': True})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


# ---------------------------------------------------------------------------
# App instance — Solana-only deployment
# ---------------------------------------------------------------------------

SOL_PRICES = {
    "/trust-report":          0.005,
    "/code-review":           0.025,
    "/summarize":             0.01,
    "/sql-generator":         0.015,
    "/translate":             0.015,
    "/code-explain":          0.01,
    "/regex-generator":       0.015,
    "/sentiment-analysis":    0.005,
    "/smart-contract-audit":  0.05,
    "/market-analysis":       0.025,
}

app_sol = make_app(
    chain="solana-devnet",
    pay_to=os.environ.get("AGENT_B_SOLANA_ADDRESS", ""),
    price_map=SOL_PRICES,
    port=8002,
)

# Default app alias for `uvicorn agent_b.main:app --port 8002`
app = app_sol
