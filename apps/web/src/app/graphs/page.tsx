"use client";

import { AlertTriangle, Copy, Link2, Plus, Trash2, Upload, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { GraphSummary, TemplateInfo } from "@/lib/types";

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
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const refresh = () => api.listGraphs().then(setGraphs).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
    api.listTemplates().then(setTemplates).catch(() => {});
  }, []);

  const create = async () => router.push(`/graphs/${(await api.createGraph(starter)).id}`);
  const fromTemplate = async (slug: string) => router.push(`/graphs/${(await api.fromTemplate(slug)).id}`);
  const duplicate = async (id: string) => {
    await api.duplicateGraph(id);
    refresh();
  };
  const remove = async (id: string) => {
    await api.deleteGraph(id);
    refresh();
  };
  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const g = await api.createGraph({ name: data.name ?? file.name.replace(/\.json$/, ""), description: data.description, nodes: data.nodes ?? [], edges: data.edges ?? [] });
      router.push(`/graphs/${g.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `could not import: ${String(e)}`);
    }
  };

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Workflow size={20} className="text-sky-400" /> Agent Studio
          </h1>
          <p className="mt-1 text-sm text-muted">Build, run and debug multi-agent workflows.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-2 text-sm text-muted hover:text-fg" title="Import a graph JSON exported from the editor">
            <Upload size={15} /> Import
          </button>
          <button onClick={create} className="flex items-center gap-1.5 rounded-md bg-sky-500/15 px-3 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/25">
            <Plus size={15} /> New graph
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

      {templates.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">Start from a template</h2>
          <div className="grid grid-cols-2 gap-3">
            {templates.map((t) => (
              <button key={t.id} onClick={() => fromTemplate(t.id)} className="rounded-xl border border-edge bg-panel p-4 text-left hover:border-sky-500/40 hover:bg-white/[.03]">
                <div className="text-sm font-medium">{t.name}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.node_types.map((k) => (
                    <span key={k} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted">{k}</span>
                  ))}
                  <span className="ml-auto text-[10px] text-muted">{t.nodes} nodes</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">Your graphs</h2>
      {graphs && graphs.length === 0 && <p className="text-sm text-muted">No graphs yet. Create one or start from a template.</p>}
      <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-panel">
        {graphs?.map((g) => (
          <li key={g.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[.03]">
            <Link href={`/graphs/${g.id}`} className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{g.name}</div>
              <div className="mt-0.5 text-xs text-muted">
                {g.nodes} nodes · v{g.version} · {new Date(g.updated_at).toLocaleString()}
              </div>
            </Link>
            {g.shared && <Link2 size={13} className="text-sky-300" aria-label="shared with a link" />}
            {g.issues > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-400" title="Unresolved issues">
                <AlertTriangle size={13} /> {g.issues}
              </span>
            )}
            <button onClick={() => duplicate(g.id)} className="rounded p-1.5 text-muted hover:bg-white/5 hover:text-fg" title="Duplicate">
              <Copy size={14} />
            </button>
            <button onClick={() => remove(g.id)} className="rounded p-1.5 text-muted hover:bg-white/5 hover:text-rose-400" title="Delete">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
