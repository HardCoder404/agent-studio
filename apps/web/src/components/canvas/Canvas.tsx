"use client";

import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow, type OnSelectionChangeParams } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { nodeTypes } from "@/components/nodes";
import type { NodeType } from "@/lib/types";
import { useGraphStore, useTemporal } from "@/store/graph";

export const DRAG_MIME = "application/agent-studio-node";

export function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, select } = useGraphStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      onNodesChange: s.onNodesChange,
      onEdgesChange: s.onEdgesChange,
      onConnect: s.onConnect,
      addNode: s.addNode,
      select: s.select,
    })),
  );
  const { screenToFlowPosition } = useReactFlow();
  const temporal = useTemporal();

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DRAG_MIME) as NodeType;
      if (!type) return;
      addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addNode, screenToFlowPosition],
  );

  const onSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams) => select(nodes.length === 1 ? nodes[0].id : null),
    [select],
  );

  // ⌘Z / ⇧⌘Z undo-redo, unless typing in a field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable=true]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) temporal.getState().redo();
        else temporal.getState().undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [temporal]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onSelectionChange={onSelectionChange}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      deleteKeyCode={["Backspace", "Delete"]}
      onError={(code, message) => {
        // 008 = edge points at a handle that is not measured yet; happens for one frame after a
        // router branch is renamed, then updateNodeInternals catches up.
        if (code !== "008") console.warn(`[React Flow ${code}] ${message}`);
      }}
      defaultEdgeOptions={{ type: "smoothstep", style: { strokeWidth: 1.5 } }}
      className="bg-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--grid)" />
      <Controls position="bottom-left" showInteractive={false} className="!m-3" />
      <MiniMap position="bottom-right" pannable zoomable className="!m-3 !bg-panel" maskColor="rgb(0 0 0 / .5)" nodeColor="#52525b" />
    </ReactFlow>
  );
}
