"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LucideIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useGraphStore } from "@/store/graph";

type Props = {
  id: string;
  selected?: boolean;
  icon: LucideIcon;
  tone: string; // tailwind color stem, e.g. "sky"
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

export function NodeShell({ id, selected, icon: Icon, tone, title, subtitle, input = true, output = true, children }: Props) {
  const issues = useGraphStore(useShallow((s) => s.issues.filter((i) => i.node === id)));
  return (
    <div
      className={`group relative min-w-44 max-w-64 rounded-xl border bg-panel text-sm shadow-lg shadow-black/30 transition-shadow ${tones[tone]} ${
        selected ? "ring-2 ring-(--tone) ring-offset-2 ring-offset-canvas" : ""
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
        {issues.length > 0 && (
          <span title={issues.map((i) => i.message).join("\n")} className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px] shadow-amber-400/60" />
        )}
      </div>
      {children && <div className="border-t border-white/5 px-3 py-2 text-[11px] text-muted">{children}</div>}
      {output && <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-canvas !bg-(--tone)" />}
    </div>
  );
}

export type StudioNodeProps = NodeProps & { data: { label: string; config: Record<string, unknown> } };
