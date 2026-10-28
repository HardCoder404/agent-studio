"use client";

import { useReactFlow } from "@xyflow/react";
import { Bot, Code2, Flag, GitFork, LayoutGrid, List, Maximize2, Play, Redo2, Trash2, Undo2, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { nodeMeta, type NodeType } from "@/lib/types";
import { useGraphStore, useTemporal } from "@/store/graph";

type Command = { id: string; title: string; hint?: string; icon: LucideIcon; keys?: string; run: () => void; disabled?: boolean };

const nodeIcons: Record<NodeType, LucideIcon> = { start: Play, llm: Bot, tool: Wrench, router: GitFork, human: UserRound, code: Code2, end: Flag };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const router = useRouter();
  const { fitView, screenToFlowPosition } = useReactFlow();
  const temporal = useTemporal();
  const addNode = useGraphStore((s) => s.addNode);
  const removeNode = useGraphStore((s) => s.removeNode);
  const selectedId = useGraphStore((s) => s.selectedId);
  const issues = useGraphStore((s) => s.issues.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQ("");
        setCursor(0);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const addAt = (type: NodeType) => () => {
      const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
      const p = screenToFlowPosition({ x: rect ? rect.left + rect.width / 2 : 600, y: rect ? rect.top + rect.height / 2 : 400 });
      addNode(type, p);
    };
    const nodeCmds = (Object.keys(nodeMeta) as NodeType[]).map<Command>((t) => ({
      id: `add-${t}`,
      title: `Add ${nodeMeta[t].title} node`,
      hint: nodeMeta[t].hint,
      icon: nodeIcons[t],
      run: addAt(t),
    }));
    return [
      { id: "run", title: "Run graph", hint: issues ? `${issues} issue(s) to fix first` : undefined, icon: Play, keys: "⌘↵", run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true })), disabled: issues > 0 },
      { id: "fit", title: "Fit view", icon: Maximize2, keys: "⇧1", run: () => fitView({ padding: 0.3, duration: 250 }) },
      { id: "undo", title: "Undo", icon: Undo2, keys: "⌘Z", run: () => temporal.getState().undo() },
      { id: "redo", title: "Redo", icon: Redo2, keys: "⇧⌘Z", run: () => temporal.getState().redo() },
      { id: "delete", title: "Delete selected node", icon: Trash2, keys: "⌫", run: () => selectedId && removeNode(selectedId), disabled: !selectedId || selectedId === "start" },
      ...nodeCmds,
      { id: "graphs", title: "All graphs", icon: List, run: () => router.push("/graphs") },
      { id: "tidy", title: "Tidy layout", hint: "coming soon", icon: LayoutGrid, run: () => {}, disabled: true },
    ];
  }, [addNode, fitView, issues, removeNode, router, screenToFlowPosition, selectedId, temporal]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => (c.title + " " + (c.hint ?? "")).toLowerCase().includes(needle));
  }, [commands, q]);

  if (!open) return null;

  const pick = (c: Command) => {
    if (c.disabled) return;
    setOpen(false);
    c.run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[18vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div className="card w-[34rem] overflow-hidden shadow-2xl shadow-black/70" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, filtered.length - 1));
            else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
            else if (e.key === "Enter" && filtered[cursor]) pick(filtered[cursor]);
          }}
          placeholder="Type a command…"
          className="w-full border-b border-edge bg-transparent px-4 py-3.5 text-[14px] text-fg outline-none placeholder:text-dim"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && <li className="px-4 py-3 text-sm text-muted">No matches.</li>}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(c)}
              className={`mx-1.5 flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${i === cursor ? "bg-panel-3" : ""} ${c.disabled ? "opacity-40" : ""}`}
            >
              <c.icon size={15} className={i === cursor ? "text-accent" : "text-muted"} />
              <span className="flex-1">
                {c.title}
                {c.hint && <span className="ml-2 text-xs text-muted">{c.hint}</span>}
              </span>
              {c.keys && <kbd className="kbd">{c.keys}</kbd>}
            </li>
          ))}
        </ul>
        <div className="flex gap-3 border-t border-edge bg-panel-2/50 px-4 py-2 text-[10.5px] text-dim"><span><kbd className="kbd">↑↓</kbd> navigate</span><span><kbd className="kbd">↵</kbd> run</span><span><kbd className="kbd">esc</kbd> close</span></div>
      </div>
    </div>
  );
}
