"use client";

import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "@/components/nodes";
import type { GraphSpec } from "@/lib/types";
import { toFlow } from "@/store/graph";

/** Read-only canvas of an example template. No store, no editing; fits the whole graph into view. */
export function TemplatePreview({ spec }: { spec: GraphSpec }) {
  const { nodes, edges } = toFlow(spec);
  return (
    <ReactFlowProvider>
      <ReactFlow
        key={spec.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 0.9 }}
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
      </ReactFlow>
    </ReactFlowProvider>
  );
}
