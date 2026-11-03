"use client";

import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useEdgesState, useNodesInitialized, useNodesState, useReactFlow, useStore } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { useRunStore, type NodeStatus } from "@/store/run";
import { nodeTypes } from "@/components/nodes";
import type { GraphSpec } from "@/lib/types";
import { toFlow } from "@/store/graph";

const FIT = { padding: 0.12, maxZoom: 1, duration: 0 };

/** Keeps the whole graph in view: refits once nodes are measured and whenever React Flow records a new box size. */
function Fitter() {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    if (!ready || !width || !height) return;
    const id = requestAnimationFrame(() => {
      fitView(FIT);
    });
    return () => cancelAnimationFrame(id);
  }, [ready, width, height, fitView]);
  return null;
}

/** A looping, scripted run for the landing hero: walks the graph from Start, pauses at human nodes, then resets.
 *  Drives the run store's replayStatus so the real node rings and badges light up. */
function useSimulatedRun(spec: GraphSpec, enabled: boolean): Record<string, NodeStatus> {
  const [statuses, setStatuses] = useState<Record<string, NodeStatus>>({});
  const path = useMemo(() => {
    if (!enabled) return [] as string[];
    const out = new Map<string, string[]>();
    for (const e of spec.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    const byId = Object.fromEntries(spec.nodes.map((n) => [n.id, n]));
    const start = spec.nodes.find((n) => n.type === "start")?.id;
    const seq: string[] = [];
    let cur = start, guard = 0;
    while (cur && guard++ < 24) {
      seq.push(cur);
      const nexts = out.get(cur) ?? [];
      if (!nexts.length) break;
      // routers: take the branch that leads on (prefer an unvisited target), everything else follows its only edge
      cur = byId[cur]?.type === "router" ? (nexts.find((t) => !seq.includes(t)) ?? nexts[0]) : nexts[0];
      if (seq.filter((x) => x === cur).length > 1) break;
    }
    return seq;
  }, [spec, enabled]);
  useEffect(() => {
    if (!enabled || !path.length) return;
    let alive = true;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => alive && fn(), ms));
    const byId = Object.fromEntries(spec.nodes.map((n) => [n.id, n]));
    const run = () => {
      const st: Record<string, NodeStatus> = {};
      let t = 400;
      for (const id of path) {
        const type = byId[id]?.type;
        const hold = type === "human" ? 1600 : type === "llm" ? 1100 : 500;
        at(t, () => { st[id] = type === "human" ? "paused" : "running"; setStatuses({ ...st }); useRunStore.setState({ replayStatus: { ...st } }); });
        t += hold;
        at(t, () => { st[id] = "done"; setStatuses({ ...st }); useRunStore.setState({ replayStatus: { ...st } }); });
        t += 250;
      }
      at(t + 1800, () => { setStatuses({}); useRunStore.setState({ replayStatus: {} }); });
      // loop again, but not while the tab is hidden: wait for it to come back first
      at(t + 2400, () => {
        if (document.visibilityState === "visible") return run();
        const once = () => { document.removeEventListener("visibilitychange", once); if (alive && document.visibilityState === "visible") run(); };
        document.addEventListener("visibilitychange", once);
      });
    };
    run();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      useRunStore.setState({ replayStatus: null });
    };
  }, [enabled, path, spec]);
  return statuses;
}

/** Controlled nodes so React Flow can write measured sizes back; remounted per template via the key above. */
function Canvas({ spec, simulate }: { spec: GraphSpec; simulate: boolean }) {
  const flow = toFlow(spec);
  const [nodes, , onNodesChange] = useNodesState(flow.nodes);
  const [rawEdges, , onEdgesChange] = useEdgesState(flow.edges);
  const st = useSimulatedRun(spec, simulate);
  // same rule as the editor: an edge flows while its target is running/paused and its source is done
  const edges = useMemo(
    () =>
      rawEdges.map((e) => {
        const active = (st[e.target] === "running" || st[e.target] === "paused") && st[e.source] === "done";
        const walked = st[e.target] === "done" && st[e.source] === "done";
        return { ...e, animated: active, style: { strokeWidth: active ? 2.5 : 1.5, stroke: active ? "#38bdf8" : walked ? "#34d399" : undefined } };
      }),
    [rawEdges, st],
  );
  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT}
        minZoom={0.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
        className="bg-canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--grid)" />
        <Fitter />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

/** Read-only canvas of an example template. No store, no editing; the whole graph always fits the box. */
export function TemplatePreview({ spec, simulate = false }: { spec: GraphSpec; simulate?: boolean }) {
  return (
    <div className="h-full w-full">
      <Canvas key={spec.id} spec={spec} simulate={simulate} />
    </div>
  );
}
