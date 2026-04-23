"use client";

import * as d3 from "d3";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Agent extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  reputation: number;
  chain: "avalanche-fuji" | "solana-devnet";
}

interface Job {
  id: string;
  from: string;
  to: string;
  amount: number;
  chain: string;
  status: "pending" | "paying" | "confirmed" | "done";
}

interface EdgePulse {
  id: string;
  fromId: string;
  toId: string;
  startedAt: number;
  durationMs?: number;
}

function tierColor(reputation: number): string {
  if (reputation >= 750) return "#FFD700";
  if (reputation >= 500) return "#C0C0C0";
  return "#CD7F32";
}

interface Props {
  agents?: Agent[];
  jobs?: Job[];
  wsUrl?: string;
}

export function AgentGraph({ agents = [], jobs = [], wsUrl = "ws://localhost:3001" }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const simRef = useRef<any>(null);
  const nodePositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [pulses, setPulses] = useState<EdgePulse[]>([]);
  const [realAgents, setRealAgents] = useState<Agent[]>([]);
  const [realEdges, setRealEdges] = useState<Job[]>([]);
  const [liveEdges, setLiveEdges] = useState<Array<Job & { expiresAt: number; createdAt: number }>>([]);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // Fetch real agents and transaction edges
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const parsed: Agent[] = (data.agents ?? []).map((a: any) => ({
          id: String(a.id ?? a.name),
          name: a.name,
          reputation: a.reputation > 1 ? a.reputation : Math.round(a.reputation * 1000),
          chain: a.chain ?? "solana-devnet",
        }));
        setRealAgents(parsed);
      })
      .catch(() => {});

    fetch("/api/transactions")
      .then((r) => r.json())
      .then((data) => {
        // Build edge weight map from transaction history
        const edgeWeights = new Map<string, number>();
        for (const tx of data.transactions ?? []) {
          const key = `${tx.from ?? "agent-a"}→${tx.to ?? "agent-b"}`;
          edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
        }
        const edges: Job[] = Array.from(edgeWeights.entries()).map(([key, count], i) => {
          const [from, to] = key.split("→");
          return { id: `edge-${i}`, from, to, amount: count * 0.005, chain: "solana-devnet", status: "done" as const };
        });
        setRealEdges(edges);
      })
      .catch(() => {});
  }, []);

  const AGENT_A_NODE: Agent = { id: "agent-a", name: "Agent A (Buyer)", reputation: 0, chain: "avalanche-fuji" };

  // Build final node list: Agent A + top 6 registry agents
  const nodes: Agent[] = (() => {
    const base = realAgents.length > 0 ? realAgents : agents;
    if (!base.length) {
      return [
        AGENT_A_NODE,
        { id: "trust-fuji",  name: "Trust Reporter", reputation: 847, chain: "avalanche-fuji" },
        { id: "code-sol",    name: "Code Reviewer",  reputation: 612, chain: "solana-devnet" },
        { id: "summarizer",  name: "Summariser",     reputation: 750, chain: "avalanche-fuji" },
        { id: "sql-gen",     name: "SQL Generator",  reputation: 530, chain: "solana-devnet" },
      ];
    }
    const top6 = base
      .filter((a) => a.id !== "agent-a")
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, 6);
    return [AGENT_A_NODE, ...top6];
  })();

  // Prefer real transaction edges; fallback to a simple star graph.
  const baseLinks: Job[] = realEdges.length > 0
    ? realEdges
    : nodes.slice(1).map((n, i) => ({
        id: `edge-${i}`,
        from: "agent-a",
        to: n.id,
        amount: 0.005,
        chain: n.chain,
        status: "done" as const,
      }));
  const links: Array<Job & { expiresAt?: number; createdAt?: number }> = [...baseLinks, ...liveEdges];

  // Listen for payment events and trigger edge pulses
  useEffect(() => {
    let ws: WebSocket;
    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (msg) => {
          try {
            const e = JSON.parse(msg.data);
            if (e.event === "payment_initiated") {
              const pulse: EdgePulse = {
                id: String(Date.now()),
                fromId: e.from || "agent-a",
                toId: e.to || "trust-fuji",
                startedAt: Date.now(),
                durationMs: 1800,
              };
              setPulses((prev) => [...prev, pulse]);
              setTimeout(() => setPulses((prev) => prev.filter((p) => p.id !== pulse.id)), 1800);
            }
            if (e.event === "payment_confirmed") {
              const edgeId = `live-${Date.now()}`;
              const expiresAt = Date.now() + 30_000;
              setLiveEdges((prev) => [
                ...prev,
                {
                  id: edgeId,
                  from: "agent-a",
                  to: String(e.to || "trust-reporter-sol"),
                  amount: Number(e.amount || 0.005),
                  chain: String(e.chain || "solana"),
                  status: "confirmed",
                  createdAt: Date.now(),
                  expiresAt,
                },
              ]);
              setTimeout(() => {
                setLiveEdges((prev) => prev.filter((edge) => edge.id !== edgeId));
              }, 30_000);
              const pulse: EdgePulse = {
                id: `pulse-${Date.now()}`,
                fromId: "agent-a",
                toId: String(e.to || "trust-reporter-sol"),
                startedAt: Date.now(),
                durationMs: 1000,
              };
              setPulses((prev) => [...prev, pulse]);
              setTimeout(() => setPulses((prev) => prev.filter((p) => p.id !== pulse.id)), 1000);
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => setTimeout(connect, 3000);
      } catch { setTimeout(connect, 5000); }
    }
    connect();
    return () => ws?.close();
  }, [wsUrl]);

  // Drive fade animation for live edges.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const { width, height } = svgRef.current.getBoundingClientRect();
    console.log("links:", links);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const nameToId = new Map(nodes.map((n) => [n.name.toLowerCase(), n.id]));
    const normalizedLinks = links.map((l) => {
      const normalizedTo =
        l.to === "agent-a" ? "agent-a" : nameToId.get(String(l.to).toLowerCase()) ?? l.to;
      return {
        ...l,
        from: "agent-a",
        to: normalizedTo,
      };
    });
    const graphLinks = normalizedLinks
      .filter((l) => !!l.from && !!l.to && nodeIds.has(l.from) && nodeIds.has(l.to))
      .map((l) => ({ ...l, source: l.from, target: l.to }));

    svg.selectAll("*").remove();

    const defs = svg.append("defs");

    // Arrowhead
    defs.append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 30)
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#00ff88");

    // Glow filter
    const filter = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
    filter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "coloredBlur");
    const merge = filter.append("feMerge");
    merge.append("feMergeNode").attr("in", "coloredBlur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    // Pulse dot filter (brighter glow)
    const pulseFilter = defs.append("filter").attr("id", "pulse-glow").attr("x", "-100%").attr("y", "-100%").attr("width", "300%").attr("height", "300%");
    pulseFilter.append("feGaussianBlur").attr("stdDeviation", "6").attr("result", "coloredBlur");
    const pm = pulseFilter.append("feMerge");
    pm.append("feMergeNode").attr("in", "coloredBlur");
    pm.append("feMergeNode").attr("in", "SourceGraphic");

    const g = svg.append("g");

    const linkSel = g.append("g").selectAll("line")
      .data(graphLinks as any)
      .join("line")
      .attr("stroke", "#00ff88")
      .attr("stroke-opacity", (d: any) => {
        if (!d.expiresAt) return 0.6;
        const remaining = Math.max(0, d.expiresAt - nowMs);
        return Math.max(0.08, 0.9 * (remaining / 30_000));
      })
      // Thicker edge = more jobs/volume between the same two nodes.
      .attr("stroke-width", (d: any) => {
        const jobs = Math.max(1, Math.round((d.amount ?? 0.005) / 0.005));
        return Math.max(2, Math.min(8, 1.2 + jobs * 0.5));
      })
      .attr("marker-end", "url(#arrow)");

    const nodeSel = g.append("g").selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", (_, d) => router.push(`/agent/${d.id}`))
      .call(
        d3.drag<SVGGElement, Agent>()
          .on("start", (event, d) => {
            if (!event.active) simRef.current?.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => {
            if (!event.active) simRef.current?.alphaTarget(0);
            d.fx = null; d.fy = null;
          }) as any
      );

    // Outer glow ring
    nodeSel.append("circle")
      .attr("r", (d) => 18 + (d.reputation / 80))
      .attr("fill", "none")
      .attr("stroke", (d) => tierColor(d.reputation))
      .attr("stroke-width", 1)
      .attr("opacity", 0.25);

    // Main node circle
    nodeSel.append("circle")
      .attr("r", (d) => 16 + (d.reputation / 90))
      .attr("fill", (d) => tierColor(d.reputation))
      .attr("stroke", "#0a0a0a")
      .attr("stroke-width", 2)
      .attr("filter", "url(#glow)");

    // Label text
    nodeSel.append("text")
      .attr("dy", (d) => `${2.8 + d.reputation / 400}em`)
      .attr("text-anchor", "middle")
      .attr("fill", "#aaa")
      .attr("font-size", "10px")
      .attr("font-family", "monospace")
      .text((d) => d.name);

    // Rep/ID text inside circle
    nodeSel.append("text")
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .attr("fill", "#000")
      .attr("font-size", "9px")
      .attr("font-weight", "bold")
      .attr("font-family", "monospace")
      .text((d) => d.reputation > 0 ? d.reputation.toString() : "A");

    const sim = d3.forceSimulation(nodes as any)
      .force("link", d3.forceLink(graphLinks as any).id((d: any) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(40));

    const agentANode = nodes.find((n) => n.id === "agent-a");
    if (agentANode) {
      agentANode.fx = width / 2;
      agentANode.fy = height / 2;
    }

    simRef.current = sim;

    sim.on("tick", () => {
      linkSel
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      nodeSel.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

      // Update positions for pulse rendering
      nodes.forEach((n: any) => {
        if (n.x !== undefined) nodePositions.current.set(n.id, { x: n.x, y: n.y });
      });
    });

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on("zoom", (event) => g.attr("transform", event.transform))
    );

    return () => { sim.stop(); };
  }, [agents, jobs, realAgents, realEdges, liveEdges, nowMs, router]);

  // Render traveling pulse dots as SVG overlays
  const pulseDots = pulses.map((pulse) => {
    const from = nodePositions.current.get(pulse.fromId);
    const to = nodePositions.current.get(pulse.toId);
    if (!from || !to) return null;
    const duration = pulse.durationMs ?? 1600;
    const elapsed = (Date.now() - pulse.startedAt) / duration;
    const t = Math.min(elapsed, 1);
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    return { id: pulse.id, x, y };
  }).filter(Boolean);

  return (
    <div className="relative w-full h-full bg-[#0a0a0a] rounded-lg border border-[#1a1a1a] overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />

      {/* Pulse dots overlaid via React for animation frame accuracy */}
      {pulseDots.map((dot) => dot && (
        <div
          key={dot.id}
          className="absolute pointer-events-none"
          style={{
            left: dot.x - 6,
            top: dot.y - 6,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#00ff88",
            boxShadow: "0 0 16px 4px rgba(0,255,136,0.8)",
          }}
        />
      ))}

      <div className="absolute top-3 left-3 text-xs text-[#00ff88] font-mono">
        Live Agent Network
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex gap-3 text-[10px] font-mono text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" /> Gold ≥750</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300" /> Silver ≥500</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#CD7F32" }} /> Bronze</span>
      </div>
    </div>
  );
}
