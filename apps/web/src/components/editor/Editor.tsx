"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Canvas } from "@/components/canvas/Canvas";
import { BottomPanel } from "@/components/layout/BottomPanel";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { HumanGate } from "@/components/layout/HumanGate";
import { RunDialog } from "@/components/layout/RunDialog";
import { Inspector } from "@/components/layout/Inspector";
import { Palette } from "@/components/layout/Palette";
import { TopBar } from "@/components/layout/TopBar";
import { api } from "@/lib/api";
import { useGraphStore } from "@/store/graph";
import { useAutosave } from "@/store/useAutosave";
import { useRunStore } from "@/store/run";
import { useRunSocket } from "@/store/useRunSocket";

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const load = useGraphStore((s) => s.load);
  const loaded = useGraphStore((s) => s.graphId === id);
  const [error, setError] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  useAutosave();
  useRunSocket();

  // ⌘↵ opens the run dialog; leaving the editor clears the run view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (useGraphStore.getState().issues.length === 0) setRunOpen(true);
      }
    };
    // @monaco-editor/react cancels its loader promise when an editor unmounts mid-load; the
    // rejection is harmless noise, keep it out of the dev overlay
    const onRejection = (e: PromiseRejectionEvent) => {
      if (e.reason && typeof e.reason === "object" && (e.reason as { type?: string }).type === "cancelation") e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("unhandledrejection", onRejection);
      useRunStore.getState().clear();
    };
  }, []);

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
        <TopBar onRun={() => setRunOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <Palette />
          <div className="relative min-w-0 flex-1">
            <Canvas />
            <HumanGate />
          </div>
          <Inspector />
        </div>
        <BottomPanel />
      </div>
      <CommandPalette />
      {runOpen && <RunDialog onClose={() => setRunOpen(false)} />}
    </ReactFlowProvider>
  );
}
