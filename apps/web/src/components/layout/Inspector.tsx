"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { StatePanel } from "@/components/panel/StatePanel";
import { useRunStore } from "@/store/run";
import { CodeForm } from "@/components/inspector/CodeForm";
import { Field, TextInput } from "@/components/inspector/Field";
import { HumanForm } from "@/components/inspector/HumanForm";
import { LLMForm } from "@/components/inspector/LLMForm";
import { RouterForm } from "@/components/inspector/RouterForm";
import { ToolForm } from "@/components/inspector/ToolForm";
import { upstreamKeys } from "@/lib/graphUtils";
import { nodeMeta, type CodeConfig, type HumanConfig, type LLMConfig, type NodeType, type RouterConfig, type ToolConfig } from "@/lib/types";
import { useGraphStore } from "@/store/graph";

type Tab = "node" | "state";

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const hasRun = useRunStore((s) => !!s.runId);
  if (!hasRun) return null;
  return (
    <div className="flex gap-1">
      {(["node", "state"] as const).map((t) => (
        <button key={t} onClick={() => setTab(t)} className={`rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${tab === t ? "bg-white/5 text-fg" : "text-muted hover:text-fg"}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

function Shell({ title, onDelete, tabs, children }: { title: string; onDelete?: () => void; tabs?: React.ReactNode; children: React.ReactNode }) {
  return (
    <aside className="flex w-[22rem] shrink-0 flex-col overflow-y-auto border-l border-edge bg-panel">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{title}</div>
          {tabs}
        </div>
        {onDelete && (
          <button onClick={onDelete} className="rounded p-1 text-muted hover:bg-white/5 hover:text-rose-400" title="Delete node (⌫)">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </aside>
  );
}

export function Inspector() {
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === s.selectedId));
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const issues = useGraphStore((s) => s.issues);
  const updateNode = useGraphStore((s) => s.updateNode);
  const updateConfig = useGraphStore((s) => s.updateConfig);
  const removeNode = useGraphStore((s) => s.removeNode);

  const vars = useMemo(() => (node ? upstreamKeys(node.id, nodes, edges) : []), [node, nodes, edges]);
  const [tab, setTab] = useState<Tab>("node");
  const hasRun = useRunStore((s) => !!s.runId);
  const tabs = <Tabs tab={tab} setTab={setTab} />;

  if (hasRun && tab === "state") {
    return (
      <Shell title="Run state" tabs={tabs}>
        <div className="-mx-4 h-[calc(100vh-8rem)]">
          <StatePanel />
        </div>
      </Shell>
    );
  }

  if (!node) {
    return (
      <Shell title="Inspector" tabs={tabs}>
        <p className="text-sm text-muted">Select a node to edit it.</p>
        {issues.length > 0 && (
          <div>
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
      </Shell>
    );
  }

  const type = node.type as NodeType;
  const nodeIssues = issues.filter((i) => i.node === node.id);
  const onChange = (patch: Record<string, unknown>) => updateConfig(node.id, patch);
  const cfg = node.data.config;

  return (
    <Shell title={nodeMeta[type].title} tabs={tabs} onDelete={type !== "start" ? () => removeNode(node.id) : undefined}>
      <Field label="Label" hint={node.id}>
        <TextInput value={node.data.label} onChange={(e) => updateNode(node.id, { label: e.target.value })} />
      </Field>
      {nodeIssues.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-400/30 bg-amber-400/5 p-2 text-xs text-amber-200">
          {nodeIssues.map((i, k) => (
            <li key={k}>{i.message}</li>
          ))}
        </ul>
      )}
      {type === "llm" && <LLMForm config={cfg as unknown as LLMConfig} vars={vars} onChange={onChange} />}
      {type === "tool" && <ToolForm config={cfg as unknown as ToolConfig} vars={vars} onChange={onChange} />}
      {type === "router" && <RouterForm nodeId={node.id} config={cfg as unknown as RouterConfig} vars={vars} onChange={onChange} />}
      {type === "human" && <HumanForm config={cfg as unknown as HumanConfig} vars={vars} onChange={onChange} />}
      {type === "code" && <CodeForm config={cfg as unknown as CodeConfig} vars={vars} onChange={onChange} />}
      {(type === "start" || type === "end") && <p className="text-xs text-muted">{nodeMeta[type].hint}</p>}
    </Shell>
  );
}
