"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertCircle, Check, Loader2, PauseCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useGraphStore } from "@/store/graph";
import { useRunStore } from "@/store/run";

type Props = {
  id: string;
  selected?: boolean;
  icon: LucideIcon;
  tone: string;
  title: string;
  subtitle?: string;
  input?: boolean;
  output?: boolean;
  children?: React.ReactNode;
};

const tones: Record<string, string> = {
  emerald: "border-emerald-500/40 [--tone:theme(colors.emerald.400)]",
  rose: "border-rose-500/40 [--tone:theme(colors.rose.400)]",
  sky: "border-sky-500/40 [--tone:theme(colors.sky.400)]",
  amber: "border-amber-500/40 [--tone:theme(colors.amber.400)]",
  violet: "border-violet-500/40 [--tone:theme(colors.violet.400)]",
  pink: "border-pink-500/40 [--tone:theme(colors.pink.400)]",
  teal: "border-teal-500/40 [--tone:theme(colors.teal.400)]",
};

const statusRing: Record<string, string> = {
  running: "ring-2 ring-sky-400/80 shadow-[0_0_24px] shadow-sky-500/30 animate-pulse",
  done: "ring-1 ring-emerald-400/60",
  error: "ring-2 ring-rose-400/80",
  paused: "ring-2 ring-pink-400/80 shadow-[0_0_24px] shadow-pink-500/30",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "running") return <Loader2 size={13} className="animate-spin text-sky-300" />;
  if (status === "done") return <Check size={13} className="text-emerald-300" />;
  if (status === "error") return <AlertCircle size={13} className="text-rose-300" />;
  if (status === "paused") return <PauseCircle size={13} className="text-pink-300" />;
  return null;
}

function Stream({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [text]);
  return (
    <div ref={ref} className="nodrag nowheel absolute inset-x-0 top-full z-20 mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-sky-500/40 bg-panel/95 px-3 py-1.5 font-mono text-[10.5px] leading-snug text-sky-100 shadow-xl shadow-black/40 backdrop-blur">
      {text}
      <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-sky-300 align-middle" />
    </div>
  );
}

export function NodeShell({ id, selected, icon: Icon, tone, title, subtitle, input = true, output = true, children }: Props) {
  const issues = useGraphStore(useShallow((s) => s.issues.filter((i) => i.node === id)));
  const status = useRunStore((s) => s.nodeStatus[id] ?? "idle");
  const tokens = useRunStore((s) => s.tokens[id]);
  const output_ = useRunStore((s) => s.outputs[id]);

  const preview = status === "done" && output_ ? Object.values(output_).find((v) => typeof v === "string") : null;

  return (
    <div
      className={`group relative min-w-44 max-w-64 rounded-xl border bg-panel text-sm shadow-lg shadow-black/30 transition-shadow ${tones[tone]} ${
        selected ? "ring-2 ring-(--tone) ring-offset-2 ring-offset-canvas" : (statusRing[status] ?? "")
      }`}
    >
      {input && <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-2 !border-canvas !bg-(--tone)" />}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-(--tone)/15 text-(--tone)">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-fg">{title}</div>
          {subtitle && <div className="truncate text-[11px] text-muted">{subtitle}</div>}
        </div>
        <StatusBadge status={status} />
        {issues.length > 0 && (
          <span title={issues.map((i) => i.message).join("\n")} className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px] shadow-amber-400/60" />
        )}
      </div>
      {children && <div className="border-t border-white/5 px-3 py-2 text-[11px] text-muted">{children}</div>}
      {status === "running" && tokens && <Stream text={tokens} />}
      {typeof preview === "string" && preview && (
        <div className="nodrag nowheel pointer-events-none absolute inset-x-0 top-full z-20 mt-1 hidden max-h-28 overflow-hidden rounded-lg border border-emerald-500/40 bg-panel/95 px-3 py-1.5 text-[10.5px] leading-snug text-emerald-100/90 shadow-xl shadow-black/40 backdrop-blur group-hover:block">
          {preview.length > 240 ? preview.slice(0, 239) + "…" : preview}
        </div>
      )}
      {output && <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-canvas !bg-(--tone)" />}
    </div>
  );
}

export type StudioNodeProps = NodeProps & { data: { label: string; config: Record<string, unknown> } };
