/**
 * WebSocket relay server (port 3001).
 * Agent A connects as a producer and sends JSON events.
 * Dashboard browser clients connect as consumers and receive broadcasts.
 */

import * as http from "http";
import { WebSocket, WebSocketServer } from "ws";

const PORT = 3001;

const server = http.createServer();
const wss = new WebSocketServer({ server });

const dashboardClients = new Set<WebSocket>();
const agentClients = new Set<WebSocket>();

// ---------------------------------------------------------------------------
// Event type definitions (match agent_a/main.py emitted events)
// ---------------------------------------------------------------------------

type EventType =
  | "agent_step"
  | "agent_discovered"
  | "payment_initiated"
  | "payment_confirmed"
  | "job_completed"
  | "reputation_updated"
  | "escrow_created"
  | "escrow_released"
  | "agent_slashed";

function broadcast(event: object) {
  const payload = JSON.stringify(event);
  dashboardClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

wss.on("connection", (ws: WebSocket, req) => {
  const isAgent = req.headers["x-client-type"] === "agent";

  if (isAgent) {
    agentClients.add(ws);
    console.log(`[WS] Agent connected (${agentClients.size} agents)`);
    ws.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        console.log(`[WS] Event: ${event.event || event.type || "unknown"}`);
        broadcast(event);
      } catch {
        /* non-JSON message */
      }
    });
    ws.on("close", () => agentClients.delete(ws));
  } else {
    dashboardClients.add(ws);
    console.log(`[WS] Dashboard client connected (${dashboardClients.size} viewers)`);
    // Send connection confirmation
    ws.send(JSON.stringify({ event: "connected", timestamp: Date.now() }));
    ws.on("close", () => dashboardClients.delete(ws));
  }

  ws.on("error", (err) => console.error("[WS] Error:", err.message));
});

// ---------------------------------------------------------------------------
// Ping to keep connections alive
// ---------------------------------------------------------------------------

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  });
}, 25_000);

server.listen(PORT, () => {
  console.log(`[WS] Relay server listening on ws://localhost:${PORT}`);
  console.log(`     Agents  → connect with header x-client-type: agent`);
  console.log(`     Dashboard → connect without that header`);
});
