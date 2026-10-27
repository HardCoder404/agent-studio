"use client";

import { ArrowLeft, Check, CloudOff, Loader2, Play, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useStore } from "zustand";
import { useGraphStore, useTemporal } from "@/store/graph";

export function TopBar() {
  const name = useGraphStore((s) => s.name);
  const setName = useGraphStore((s) => s.setName);
  const save = useGraphStore((s) => s.save);
  const saveError = useGraphStore((s) => s.saveError);
  const version = useGraphStore((s) => s.version);
  const issues = useGraphStore((s) => s.issues.length);
  const temporal = useTemporal();
  const { undo, redo, pastStates, futureStates } = useStore(temporal);

  const status = {
    saved: { icon: Check, text: `Saved · v${version}`, cls: "text-muted" },
    dirty: { icon: Loader2, text: "Unsaved", cls: "text-muted" },
    saving: { icon: Loader2, text: "Saving…", cls: "text-muted" },
    error: { icon: CloudOff, text: saveError ?? "Save failed", cls: "text-rose-400" },
  }[save];

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-panel px-3">
      <Link href="/graphs" className="rounded p-1.5 text-muted hover:bg-white/5 hover:text-fg" title="All graphs">
        <ArrowLeft size={16} />
      </Link>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-fg outline-none"
        placeholder="Untitled graph"
      />
      <span className={`flex items-center gap-1.5 text-xs ${status.cls}`} title={saveError ?? undefined}>
        <status.icon size={13} className={save === "saving" ? "animate-spin" : ""} /> {status.text}
      </span>
      <div className="mx-1 h-5 w-px bg-edge" />
      <button onClick={() => undo()} disabled={!pastStates.length} className="rounded p-1.5 text-muted hover:bg-white/5 hover:text-fg disabled:opacity-30" title="Undo (⌘Z)">
        <Undo2 size={15} />
      </button>
      <button onClick={() => redo()} disabled={!futureStates.length} className="rounded p-1.5 text-muted hover:bg-white/5 hover:text-fg disabled:opacity-30" title="Redo (⇧⌘Z)">
        <Redo2 size={15} />
      </button>
      <div className="mx-1 h-5 w-px bg-edge" />
      <button
        disabled
        title={issues ? `${issues} issue${issues > 1 ? "s" : ""} to fix first` : "Run (coming soon)"}
        className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300 disabled:opacity-40"
      >
        <Play size={14} /> Run
      </button>
    </header>
  );
}
