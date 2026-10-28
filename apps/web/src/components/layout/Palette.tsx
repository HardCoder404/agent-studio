"use client";

import { useReactFlow } from "@xyflow/react";
import { Search } from "lucide-react";
import { useState } from "react";
import { Bot, Code2, Flag, GitFork, Play, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { DRAG_MIME } from "@/components/canvas/Canvas";
import { nodeMeta, type NodeType } from "@/lib/types";
import { useGraphStore } from "@/store/graph";

const items: { type: NodeType; icon: LucideIcon; tile: string; group: "flow" | "steps" }[] = [
  { type: "start", icon: Play, tile: "bg-emerald-400/12 text-emerald-300", group: "flow" },
  { type: "end", icon: Flag, tile: "bg-rose-400/12 text-rose-300", group: "flow" },
  { type: "llm", icon: Bot, tile: "bg-sky-400/12 text-sky-300", group: "steps" },
  { type: "tool", icon: Wrench, tile: "bg-amber-400/12 text-amber-300", group: "steps" },
  { type: "router", icon: GitFork, tile: "bg-violet-400/12 text-violet-300", group: "steps" },
  { type: "human", icon: UserRound, tile: "bg-pink-400/12 text-pink-300", group: "steps" },
  { type: "code", icon: Code2, tile: "bg-teal-400/12 text-teal-300", group: "steps" },
];

export function Palette() {
  const addNode = useGraphStore((s) => s.addNode);
  const [q, setQ] = useState("");
  const visible = items.filter(({ type }) => (nodeMeta[type].title + " " + nodeMeta[type].hint).toLowerCase().includes(q.toLowerCase()));
  const { screenToFlowPosition, fitView } = useReactFlow();

  const addAtCenter = (type: NodeType) => {
    // Append below the lowest node so a click builds the flow top-down; first node goes to the centre.
    const nodes = useGraphStore.getState().nodes;
    let p: { x: number; y: number };
    if (nodes.length) {
      const lowest = nodes.reduce((a, b) => (b.position.y > a.position.y ? b : a));
      p = { x: lowest.position.x, y: lowest.position.y + (lowest.measured?.height ?? 90) + 60 };
    } else {
      const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
      p = screenToFlowPosition({ x: rect ? rect.left + rect.width / 2 : 600, y: rect ? rect.top + rect.height / 2 : 400 });
    }
    addNode(type, p);
    requestAnimationFrame(() => fitView({ padding: 0.3, duration: 250, maxZoom: 1 }));
  };

  const groups: ["flow" | "steps", string][] = [
    ["steps", "Steps"],
    ["flow", "Flow"],
  ];

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-edge bg-panel">
      <div className="px-3 pt-3 pb-2">
        <label className="input flex items-center gap-1.5 py-0 text-xs text-muted">
          <Search size={12} className="shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search nodes" className="h-7 w-full bg-transparent text-fg outline-none placeholder:text-dim" />
        </label>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto px-2 pb-2">
        {groups.map(([g, label]) => {
          const rows = visible.filter((i) => i.group === g);
          if (!rows.length) return null;
          return (
            <div key={g}>
              <div className="eyebrow px-2 pb-1">{label}</div>
              <div className="flex flex-col gap-0.5">
                {rows.map(({ type, icon: Icon, tile }) => (
                  <button
                    key={type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, type);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => addAtCenter(type)}
                    title={nodeMeta[type].hint}
                    className="group flex cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-edge-2 hover:bg-panel-2 active:cursor-grabbing"
                  >
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${tile}`}>
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-fg">{nodeMeta[type].title}</span>
                      <span className="block truncate text-[10.5px] text-dim">{nodeMeta[type].hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-auto border-t border-edge px-3 py-2.5 text-[10.5px] leading-relaxed text-dim">
        Drag onto the canvas or click to add. <kbd className="kbd">⌘K</kbd> commands · <kbd className="kbd">⌘Z</kbd> undo · <kbd className="kbd">⌫</kbd> delete
      </div>
    </aside>
  );
}
