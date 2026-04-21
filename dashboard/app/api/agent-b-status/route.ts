import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FUJI_URL = process.env.AGENT_B_FUJI_URL ?? "http://localhost:8001";
const SOL_URL  = process.env.AGENT_B_SOL_URL  ?? "http://localhost:8002";

async function checkPort(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const [fujiOk, solOk] = await Promise.all([checkPort(FUJI_URL), checkPort(SOL_URL)]);
  return NextResponse.json({
    fuji: fujiOk,
    sol: solOk,
    running: fujiOk || solOk,
    fujiUrl: FUJI_URL,
    solUrl: SOL_URL,
  });
}
