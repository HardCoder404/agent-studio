"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Canvas } from "@/components/canvas/Canvas";
import { BottomPanel } from "@/components/layout/BottomPanel";
import { Inspector } from "@/components/layout/Inspector";
import { Palette } from "@/components/layout/Palette";
import { TopBar } from "@/components/layout/TopBar";
import { api } from "@/lib/api";
import { useGraphStore } from "@/store/graph";
import { useAutosave } from "@/store/useAutosave";

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const load = useGraphStore((s) => s.load);
  const loaded = useGraphStore((s) => s.graphId === id);
  const [error, setError] = useState<string | null>(null);
  useAutosave();

  useEffect(() => {
    api
      .getGraph(id)
      .then((spec) => {
        load(spec);
        useGraphStore.temporal.getState().clear();
      })
      .catch((e) => setError(String(e)));
  }, [id, load]);

  if (error) return <div className="p-6 text-sm text-rose-300">Could not load graph: {error}</div>;
  if (!loaded) return <div className="p-6 text-sm text-muted">Loading…</div>;

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <Palette />
          <div className="relative min-w-0 flex-1">
            <Canvas />
          </div>
          <Inspector />
        </div>
        <BottomPanel />
      </div>
    </ReactFlowProvider>
  );
}
