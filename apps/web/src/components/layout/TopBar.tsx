"use client";

import { ArrowLeft, Check, CloudOff, Loader2, Play, Redo2, Square, Undo2 } from "lucide-react";
import Link from "next/link";
import { useStore } from "zustand";
import { api } from "@/lib/api";
import { useGraphStore, useTemporal } from "@/store/graph";
import { isTerminal, useRunStore } from "@/store/run";

export function TopBar({ onRun }: { onRun: () => void }) {
  const name = useGraphStore((s) => s.name);
  const setName = useGraphStore((s) => s.setName);
  const save = useGraphStore((s) => s.save);
  const saveError = useGraphStore((s) => s.saveError);
  const version = useGraphStore((s) => s.version);
  const issues = useGraphStore((s) => s.issues.length);
  const temporal = useTemporal();
  const { undo, redo, pastStates, futureStates } = useStore(temporal);
  const runId = useRunStore((s) => s.runId);
  const runStatus = useRunStore((s) => s.status);
  const usage = useRunStore((s) => s.usage);
  const runError = useRunStore((s) => s.error);
  const connected = useRunStore((s) => s.connected);
  const busy = !!runId && !isTerminal(runStatus);

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
      {runStatus && (
        <span
          className={`flex items-center gap-1.5 text-xs ${
            { done: "text-emerald-300", error: "text-rose-300", paused: "text-pink-300", running: "text-sky-300", cancelled: "text-amber-300", queued: "text-muted" }[runStatus]
          }`}
          title={runError ?? (connected ? "live" : "reconnecting…")}
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {runStatus}
          {usage && runStatus === "done" && <span className="text-muted">· {usage.llm_calls} calls · ${usage.cost_usd}</span>}
        </span>
      )}
      {busy ? (
        <button onClick={() => runId && api.cancelRun(runId).catch(() => {})} className="flex items-center gap-1.5 rounded-md bg-rose-500/15 px-3 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-500/25" title="Cancel run">
          <Square size={13} /> Stop
        </button>
      ) : (
        <button
          onClick={onRun}
          disabled={issues > 0 || save === "error"}
          title={issues ? `${issues} issue${issues > 1 ? "s" : ""} to fix first` : "Run (⌘↵)"}
          className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 disabled:hover:bg-emerald-500/15"
        >
          <Play size={14} /> Run
        </button>
      )}
    </header>
  );
}
