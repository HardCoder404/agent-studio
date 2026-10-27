"use client";

import { AlertTriangle, Plus, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { GraphSummary } from "@/lib/types";

const starter = {
  name: "Untitled graph",
  nodes: [
    { id: "start", type: "start" as const, label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "end", type: "end" as const, label: "End", position: { x: 0, y: 220 }, config: {} },
  ],
  edges: [],
};

export default function GraphsPage() {
  const [graphs, setGraphs] = useState<GraphSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const refresh = () => api.listGraphs().then(setGraphs).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
    const g = await api.createGraph(starter);
    router.push(`/graphs/${g.id}`);
  };

  const remove = async (id: string) => {
    await api.deleteGraph(id);
    refresh();
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Workflow size={20} className="text-sky-400" /> Agent Studio
          </h1>
          <p className="mt-1 text-sm text-muted">Build, run and debug multi-agent workflows.</p>
        </div>
        <button onClick={create} className="flex items-center gap-1.5 rounded-md bg-sky-500/15 px-3 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/25">
          <Plus size={15} /> New graph
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          Could not reach the API ({error}). Is it running on port 8000?
        </div>
      )}

      {graphs && graphs.length === 0 && <p className="text-sm text-muted">No graphs yet. Create one to get started.</p>}

      <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-panel">
        {graphs?.map((g) => (
          <li key={g.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[.03]">
            <Link href={`/graphs/${g.id}`} className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{g.name}</div>
              <div className="mt-0.5 text-xs text-muted">
                {g.nodes} nodes · v{g.version} · {new Date(g.updated_at).toLocaleString()}
              </div>
            </Link>
            {g.issues > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-400" title="Unresolved issues">
                <AlertTriangle size={13} /> {g.issues}
              </span>
            )}
            <button onClick={() => remove(g.id)} className="rounded p-1.5 text-muted hover:bg-white/5 hover:text-rose-400" title="Delete">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
