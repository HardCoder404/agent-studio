"use client";

import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
import { Bot, Braces, Code2, Flag, GitFork, Play, UserRound, Wrench } from "lucide-react";
import type { NodeTypes } from "@xyflow/react";
import type { RouterConfig } from "@/lib/types";
import { NodeShell, type StudioNodeProps } from "./NodeShell";

const short = (s: unknown, n = 60) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

function StartNode({ id, data, selected }: StudioNodeProps) {
  return <NodeShell id={id} selected={selected} icon={Play} tone="emerald" title={data.label} subtitle="start" input={false} />;
}

function EndNode({ id, data, selected }: StudioNodeProps) {
  return <NodeShell id={id} selected={selected} icon={Flag} tone="rose" title={data.label} subtitle="end" output={false} />;
}

function LLMNode({ id, data, selected }: StudioNodeProps) {
  const c = data.config as { model?: string; prompt?: string; output_key?: string };
  return (
    <NodeShell id={id} selected={selected} icon={Bot} tone="sky" title={data.label} subtitle={c.model?.split("/").slice(1).join("/")}>
      <div className="font-mono">{short(c.prompt) || <span className="italic">empty prompt</span>}</div>
      <div className="mt-1.5 flex items-center gap-1 font-mono text-[10px] text-dim">
        <Braces size={10} /> {c.output_key}
      </div>
    </NodeShell>
  );
}

function ToolNode({ id, data, selected }: StudioNodeProps) {
  const c = data.config as { tool?: string; output_key?: string };
  return (
    <NodeShell id={id} selected={selected} icon={Wrench} tone="amber" title={data.label} subtitle={c.tool}>
      <div className="flex items-center gap-1 font-mono text-[10px] text-dim">
        <Braces size={10} /> {c.output_key}
      </div>
    </NodeShell>
  );
}

function HumanNode({ id, data, selected }: StudioNodeProps) {
  const c = data.config as { question?: string };
  return (
    <NodeShell id={id} selected={selected} icon={UserRound} tone="pink" title={data.label} subtitle="waits for a person">
      {short(c.question)}
    </NodeShell>
  );
}

function CodeNode({ id, data, selected }: StudioNodeProps) {
  const c = data.config as { source?: string };
  return (
    <NodeShell id={id} selected={selected} icon={Code2} tone="teal" title={data.label} subtitle="python">
      <div className="font-mono">{short(c.source?.split("\n")[0], 40)}</div>
    </NodeShell>
  );
}

/** Router: one source handle per branch, laid out along the bottom edge. */
function RouterNode({ id, data, selected }: StudioNodeProps) {
  const c = data.config as RouterConfig;
  const branches = c.branches ?? [];
  const labels = branches.map((b) => b.label).join("\u0000");
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, labels, updateNodeInternals]);
  return (
    <div className="relative">
      <NodeShell id={id} selected={selected} icon={GitFork} tone="violet" title={data.label} subtitle={c.mode === "llm" ? "asks a model" : "rule"} output={false}>
        <div className="flex flex-wrap gap-1">
          {branches.map((b) => (
            <span key={b.label} className="rounded-md border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">
              {b.label}
            </span>
          ))}
        </div>
      </NodeShell>
      {branches.map((b, i) => (
        <Handle
          key={b.label}
          id={b.label}
          type="source"
          position={Position.Bottom}
          style={{ left: `${((i + 1) / (branches.length + 1)) * 100}%` }}
          className="!h-3 !w-3 !rounded-full !border-2 !border-violet-400 !bg-panel"
          title={b.label}
        />
      ))}
    </div>
  );
}

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  llm: LLMNode,
  tool: ToolNode,
  router: RouterNode,
  human: HumanNode,
  code: CodeNode,
} satisfies NodeTypes;
