"use client";

import { useReactFlow } from "@xyflow/react";
import { useRef } from "react";
import { Bot, Code2, Flag, GitFork, Play, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { DRAG_MIME } from "@/components/canvas/Canvas";
import { nodeMeta, type NodeType } from "@/lib/types";
import { useGraphStore } from "@/store/graph";

const items: { type: NodeType; icon: LucideIcon; color: string }[] = [
  { type: "start", icon: Play, color: "text-emerald-400" },
  { type: "llm", icon: Bot, color: "text-sky-400" },
  { type: "tool", icon: Wrench, color: "text-amber-400" },
  { type: "router", icon: GitFork, color: "text-violet-400" },
  { type: "human", icon: UserRound, color: "text-pink-400" },
  { type: "code", icon: Code2, color: "text-teal-400" },
  { type: "end", icon: Flag, color: "text-rose-400" },
];

export function Palette() {
  const addNode = useGraphStore((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();
  const placed = useRef(0);

  const addAtCenter = (type: NodeType) => {
    // centre of the visible canvas, stepping diagonally so repeated clicks don't stack
    const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const step = (placed.current++ % 5) * 56;
    const p = screenToFlowPosition({ x: cx + step - 100, y: cy + step - 120 });
    addNode(type, p);
  };

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-edge bg-panel">
      <div className="px-3 pt-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted">Nodes</div>
      <div className="flex flex-col gap-1 px-2">
        {items.map(({ type, icon: Icon, color }) => (
          <button
            key={type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, type);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => addAtCenter(type)}
            title={nodeMeta[type].hint}
            className="flex cursor-grab items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-fg hover:bg-white/5 active:cursor-grabbing"
          >
            <Icon size={15} className={color} />
            <span className="flex-1">{nodeMeta[type].title}</span>
          </button>
        ))}
      </div>
      <p className="mt-auto px-3 pb-3 text-[11px] leading-relaxed text-muted">Drag onto the canvas, or click to add. ⌘Z undo, ⌫ delete.</p>
    </aside>
  );
}
