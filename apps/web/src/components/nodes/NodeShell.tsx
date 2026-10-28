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
  emerald: "[--tone:theme(colors.emerald.400)]",
  rose: "[--tone:theme(colors.rose.400)]",
  sky: "[--tone:theme(colors.sky.400)]",
  amber: "[--tone:theme(colors.amber.400)]",
  violet: "[--tone:theme(colors.violet.400)]",
  pink: "[--tone:theme(colors.pink.400)]",
  teal: "[--tone:theme(colors.teal.400)]",
};

const statusRing: Record<string, string> = {
  running: "border-sky-400/70 shadow-[0_0_0_3px_rgb(56_189_248/0.18),0_12px_32px_-8px_rgb(56_189_248/0.5)]",
  done: "border-emerald-400/50",
  error: "border-rose-400/80 shadow-[0_0_0_3px_rgb(251_113_133/0.2)]",
  paused: "border-pink-400/80 shadow-[0_0_0_3px_rgb(244_114_182/0.2),0_12px_32px_-8px_rgb(244_114_182/0.5)]",
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
    <div ref={ref} className="nodrag nowheel absolute inset-x-0 top-full z-20 mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-sky-400/40 bg-panel/95 px-3 py-1.5 font-mono text-[10.5px] leading-snug text-sky-100 shadow-xl shadow-black/50 backdrop-blur">
      {text}
      <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-sky-300 align-middle" />
    </div>
  );
}

export function NodeShell({ id, selected, icon: Icon, tone, title, subtitle, input = true, output = true, children }: Props) {
  const issues = useGraphStore(useShallow((s) => s.issues.filter((i) => i.node === id)));
  const replaying = useRunStore((s) => s.replayStatus !== null);
  const status = useRunStore((s) => (s.replayStatus ? (s.replayStatus[id] ?? "idle") : (s.nodeStatus[id] ?? "idle")));
  const tokens = useRunStore((s) => (s.replayStatus ? undefined : s.tokens[id]));
  const output_ = useRunStore((s) => s.outputs[id]);
  const heat = useRunStore((s) => (s.heat ? (s.heat[id] ?? 0) : null));
  const retries = useRunStore((s) => s.retries[id] ?? 0);

  const preview = !replaying && status === "done" && output_ ? Object.values(output_).find((v) => typeof v === "string") : null;

  return (
    <div
      className={`group relative min-w-48 max-w-64 rounded-xl border bg-panel text-sm shadow-[0_8px_24px_-8px_rgb(0_0_0/0.6)] transition-[box-shadow,border-color] ${tones[tone]} ${
        selected ? "border-accent shadow-[0_0_0_3px_rgb(197_241_53/0.22),0_12px_32px_-8px_rgb(0_0_0/0.7)]" : (statusRing[status] ?? "border-edge-2")
      }`}
      style={heat != null && heat > 0 ? { boxShadow: `0 0 0 2px rgb(251 191 36 / ${0.25 + heat * 0.75}), 0 0 ${8 + heat * 28}px rgb(251 191 36 / ${heat * 0.7})` } : undefined}
    >
      {heat != null && heat > 0 && (
        <span className="absolute -top-2 -right-2 rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold text-black" title="share of eval rows that failed on this node's output">
          {Math.round(heat * 100)}%
        </span>
      )}
      {input && <Handle type="target" position={Position.Top} className="!h-3 !w-3 !rounded-full !border-2 !border-(--tone) !bg-panel" />}
      {/* tone strip along the top edge */}
      <div className="absolute inset-x-3 top-0 h-px bg-(--tone)/70" />
      <div className="flex items-center gap-2.5 rounded-t-xl px-3 py-2.5" style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--tone) 9%, transparent), transparent)" }}>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-(--tone)/15 text-(--tone) ring-1 ring-(--tone)/25">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold tracking-tight text-fg">{title}</div>
          {subtitle && <div className="truncate font-mono text-[10px] text-muted">{subtitle}</div>}
        </div>
        {retries > 0 && status === "running" && (
          <span className="rounded bg-amber-400/15 px-1 text-[10px] text-amber-300" title="rate limited or connection error; backing off">retry ×{retries}</span>
        )}
        <StatusBadge status={status} />
        {issues.length > 0 && (
          <span title={issues.map((i) => i.message).join("\n")} className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px] shadow-amber-400/60" />
        )}
      </div>
      {children && <div className="border-t border-edge px-3 py-2 text-[11px] leading-relaxed text-muted">{children}</div>}
      {status === "running" && <div className="node-running pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded-b-xl" />}
      {status === "running" && tokens && <Stream text={tokens} />}
      {typeof preview === "string" && preview && (
        <div className="nodrag nowheel pointer-events-none absolute inset-x-0 top-full z-20 mt-1.5 hidden max-h-28 overflow-hidden rounded-lg border border-emerald-400/40 bg-panel/95 px-3 py-1.5 text-[10.5px] leading-snug text-emerald-100/90 shadow-xl shadow-black/50 backdrop-blur group-hover:block">
          {preview.length > 240 ? preview.slice(0, 239) + "…" : preview}
        </div>
      )}
      {output && <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !rounded-full !border-2 !border-(--tone) !bg-panel" />}
    </div>
  );
}

export type StudioNodeProps = NodeProps & { data: { label: string; config: Record<string, unknown> } };
