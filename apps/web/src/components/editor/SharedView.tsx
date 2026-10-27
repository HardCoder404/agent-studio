"use client";

import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Copy, Eye } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
        <Eye size={15} className="text-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{spec.name}</div>
          {spec.description && <div className="truncate text-[11px] text-muted">{spec.description}</div>}
        </div>
        <span className="text-xs text-muted">read-only · {spec.nodes.length} nodes</span>
        <button onClick={async () => router.push(`/graphs/${(await api.forkShared(token)).id}`)} className="flex items-center gap-1.5 rounded-md bg-sky-500/15 px-3 py-1.5 text-sm font-medium text-sky-300 hover:bg-sky-500/25">
          <Copy size={14} /> Copy to my graphs
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} defaultEdgeOptions={{ type: "smoothstep" }} className="bg-canvas">
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--grid)" />
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
