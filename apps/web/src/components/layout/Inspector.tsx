"use client";

import { Bot, Code2, Flag, GitFork, Play, SlidersHorizontal, Trash2, UserRound, Wrench, type LucideIcon } from "lucide-react";
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

const typeIcon: Record<NodeType, [LucideIcon, string]> = {
  start: [Play, "bg-emerald-400/12 text-emerald-300"],
  end: [Flag, "bg-rose-400/12 text-rose-300"],
  llm: [Bot, "bg-sky-400/12 text-sky-300"],
  tool: [Wrench, "bg-amber-400/12 text-amber-300"],
  router: [GitFork, "bg-violet-400/12 text-violet-300"],
  human: [UserRound, "bg-pink-400/12 text-pink-300"],
  code: [Code2, "bg-teal-400/12 text-teal-300"],
};

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const hasRun = useRunStore((s) => !!s.runId);
  if (!hasRun) return null;
  return (
    <div className="flex gap-0.5 rounded-lg border border-edge-2 bg-panel-2 p-0.5">
      {(["node", "state"] as const).map((t) => (
        <button key={t} onClick={() => setTab(t)} className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize transition ${tab === t ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

function Shell({ title, icon, onDelete, tabs, children }: { title: string; icon?: React.ReactNode; onDelete?: () => void; tabs?: React.ReactNode; children: React.ReactNode }) {
  return (
    <aside className="flex w-[22rem] shrink-0 flex-col overflow-y-auto border-l border-edge bg-panel">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-edge px-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <div className="truncate text-[12.5px] font-semibold tracking-tight">{title}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {tabs}
          {onDelete && (
            <button onClick={onDelete} className="icon-btn hover:!text-rose-400" title="Delete node (⌫)">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-3.5 px-4 py-4">{children}</div>
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
      <Shell title="Run state" tabs={tabs} icon={<span className="grid h-6 w-6 place-items-center rounded-md bg-accent/12 text-accent"><SlidersHorizontal size={13} /></span>}>
        <div className="-mx-4 -my-4 h-[calc(100vh-6.75rem)]">
          <StatePanel />
        </div>
      </Shell>
    );
  }

  if (!node) {
    return (
      <Shell title="Inspector" tabs={tabs} icon={<span className="grid h-6 w-6 place-items-center rounded-md bg-panel-3 text-muted"><SlidersHorizontal size={13} /></span>}>
        <div className="card-2 p-3 text-[12.5px] leading-relaxed text-muted">Select a node to edit its prompt, model, tool or branches. Drag from a node&apos;s bottom port to connect it.</div>
        {issues.length > 0 && (
          <div>
            <div className="eyebrow mb-1.5 !text-amber-400">Issues ({issues.length})</div>
            <ul className="space-y-1 rounded-lg border border-amber-400/25 bg-amber-400/5 p-2.5 text-xs text-amber-100/90">
              {issues.map((i, k) => (
                <li key={k}>
                  {i.node && <span className="font-mono text-amber-300">{i.node}: </span>}
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
  const [Icon, tile] = typeIcon[type];

  return (
    <Shell title={nodeMeta[type].title} tabs={tabs} icon={<span className={`grid h-6 w-6 place-items-center rounded-md ${tile}`}><Icon size={13} /></span>} onDelete={type !== "start" || nodes.filter((n) => n.type === "start").length > 1 ? () => removeNode(node.id) : undefined}>
      <Field label="Label" hint={node.id}>
        <TextInput value={node.data.label} onChange={(e) => updateNode(node.id, { label: e.target.value })} />
      </Field>
      {nodeIssues.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-400/25 bg-amber-400/5 p-2.5 text-xs text-amber-100/90">
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
      {(type === "start" || type === "end") && <p className="text-xs leading-relaxed text-muted">{nodeMeta[type].hint}</p>}
    </Shell>
  );
}
