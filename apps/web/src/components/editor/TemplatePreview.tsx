"use client";

import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useEdgesState, useNodesInitialized, useNodesState, useReactFlow, useStore } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect } from "react";
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

/** Controlled nodes so React Flow can write measured sizes back; remounted per template via the key above. */
function Canvas({ spec }: { spec: GraphSpec }) {
  const flow = toFlow(spec);
  const [nodes, , onNodesChange] = useNodesState(flow.nodes);
  const [edges, , onEdgesChange] = useEdgesState(flow.edges);
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
export function TemplatePreview({ spec }: { spec: GraphSpec }) {
  return (
    <div className="h-full w-full">
      <Canvas key={spec.id} spec={spec} />
    </div>
  );
}
