"use client";

import { Trash2 } from "lucide-react";
import { nodeMeta, type NodeType } from "@/lib/types";
import { useGraphStore } from "@/store/graph";

export function Inspector() {
  const selectedId = useGraphStore((s) => s.selectedId);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === s.selectedId));
  const issues = useGraphStore((s) => s.issues);
  const updateNode = useGraphStore((s) => s.updateNode);
  const removeNode = useGraphStore((s) => s.removeNode);

  if (!node || !selectedId) {
    return (
      <aside className="flex w-80 shrink-0 flex-col border-l border-edge bg-panel">
        <div className="px-4 pt-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted">Inspector</div>
        <p className="px-4 text-sm text-muted">Select a node to edit it.</p>
        {issues.length > 0 && (
          <div className="mt-4 px-4">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-amber-400">Issues ({issues.length})</div>
            <ul className="space-y-1 text-xs text-muted">
              {issues.map((i, k) => (
                <li key={k}>
                  {i.node && <span className="font-mono text-fg">{i.node}: </span>}
                  {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    );
  }

  const type = node.type as NodeType;
  const nodeIssues = issues.filter((i) => i.node === node.id);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-edge bg-panel">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{nodeMeta[type].title}</div>
        {type !== "start" && (
          <button onClick={() => removeNode(node.id)} className="rounded p-1 text-muted hover:bg-white/5 hover:text-rose-400" title="Delete node">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="space-y-3 px-4">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Label</span>
          <input
            value={node.data.label}
            onChange={(e) => updateNode(node.id, { label: e.target.value })}
            className="w-full rounded-md border border-edge bg-canvas px-2.5 py-1.5 text-sm text-fg outline-none focus:border-sky-500/60"
          />
        </label>
        <div className="text-[11px] text-muted">
          id <span className="font-mono text-fg">{node.id}</span>
        </div>
        {nodeIssues.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-400/30 bg-amber-400/5 p-2 text-xs text-amber-200">
            {nodeIssues.map((i, k) => (
              <li key={k}>{i.message}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">{nodeMeta[type].hint}</p>
        <pre className="max-h-72 overflow-auto rounded-md border border-edge bg-canvas p-2 font-mono text-[11px] text-muted">{JSON.stringify(node.data.config, null, 2)}</pre>
      </div>
    </aside>
  );
}
