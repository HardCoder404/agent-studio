"use client";

import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Copy, Eye } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/layout/Logo";
import { nodeTypes } from "@/components/nodes";
import { api } from "@/lib/api";
import type { GraphSpec } from "@/lib/types";
import { toFlow } from "@/store/graph";

/** Read-only canvas for a share link. No store, no autosave, no editing. */
export function SharedView() {
  const { token } = useParams<{ token: string }>();
  const [spec, setSpec] = useState<GraphSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    api.getShared(token).then(setSpec).catch((e) => setError(String(e)));
  }, [token]);

  if (error) return <div className="p-6 text-sm text-rose-300">This link does not work any more.</div>;
  if (!spec) return <div className="p-6 text-sm text-muted">Loading…</div>;
  const { nodes, edges } = toFlow(spec);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-panel px-4">
        <Logo size="sm" />
        <span className="pill border border-edge-2 bg-panel-2 text-muted"><Eye size={11} /> read-only</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{spec.name}</div>
          {spec.description && <div className="truncate text-[11px] text-muted">{spec.description}</div>}
        </div>
        <span className="font-mono text-[11px] text-dim">{spec.nodes.length} nodes</span>
        <button onClick={async () => router.push(`/graphs/${(await api.forkShared(token)).id}`)} className="btn btn-sm btn-primary">
          <Copy size={13} /> Copy to my graphs
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ type: "smoothstep" }} className="bg-canvas">
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--grid)" />
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
