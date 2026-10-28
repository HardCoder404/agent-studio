"use client";

import { ArrowLeft, Check, CloudOff, ExternalLink, Loader2, Play, Redo2, Square, Undo2 } from "lucide-react";
import Link from "next/link";
import { useStore } from "zustand";
import { API_URL, api } from "@/lib/api";
import { GraphMenu } from "./GraphMenu";
import { Logo } from "./Logo";
import { useGraphStore, useTemporal } from "@/store/graph";
import { isTerminal, useRunStore } from "@/store/run";

const runTone: Record<string, string> = { done: "bg-emerald-400", error: "bg-rose-400", paused: "bg-pink-400", running: "bg-sky-400", cancelled: "bg-amber-400", queued: "bg-zinc-500" };

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
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-panel px-3">
      <Link href="/graphs" className="icon-btn" title="All graphs">
        <ArrowLeft size={16} />
      </Link>
      <Link href="/graphs" className="hidden items-center gap-2 pr-1 sm:flex" title="Agent Studio">
        <Logo size="sm" />
      </Link>
      <span className="hidden text-dim sm:inline">/</span>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[13.5px] font-semibold tracking-tight text-fg outline-none transition hover:bg-panel-2 focus:bg-panel-2"
        placeholder="Untitled graph"
      />
      <span className={`hidden items-center gap-1.5 text-[11.5px] md:flex ${status.cls}`} title={saveError ?? undefined}>
        <status.icon size={12} className={save === "saving" ? "animate-spin" : ""} /> {status.text}
      </span>
      {issues > 0 && (
        <span className="pill bg-amber-400/10 text-amber-300" title="open the inspector to see the issues">{issues} issue{issues > 1 ? "s" : ""}</span>
      )}
      <div className="mx-1 h-5 w-px bg-edge-2" />
      <button onClick={() => undo()} disabled={!pastStates.length} className="icon-btn" title="Undo (⌘Z)">
        <Undo2 size={15} />
      </button>
      <button onClick={() => redo()} disabled={!futureStates.length} className="icon-btn" title="Redo (⇧⌘Z)">
        <Redo2 size={15} />
      </button>
      <GraphMenu />
      <div className="mx-1 h-5 w-px bg-edge-2" />
      {runStatus && (
        <span className="pill border border-edge-2 bg-panel-2 text-muted" title={runError ?? (connected ? "live" : "reconnecting…")}>
          {busy ? <Loader2 size={11} className="animate-spin text-sky-300" /> : <span className={`h-1.5 w-1.5 rounded-full ${runTone[runStatus] ?? "bg-zinc-500"}`} />}
          <span className="text-fg">{runStatus}</span>
          {usage && runStatus === "done" && <span className="font-mono text-dim">· {usage.llm_calls} calls · ${usage.cost_usd}</span>}
        </span>
      )}
      {runId && isTerminal(runStatus) && (
        <a href={`${API_URL}/runs/${runId}/trace`} target="_blank" rel="noreferrer" className="btn btn-sm btn-quiet" title="OpenTelemetry-style trace JSON for this run">
          <ExternalLink size={12} /> trace
        </a>
      )}
      {busy ? (
        <button onClick={() => runId && api.cancelRun(runId).catch(() => {})} className="btn btn-sm btn-danger" title="Cancel run">
          <Square size={12} /> Stop
        </button>
      ) : (
        <button
          onClick={onRun}
          disabled={issues > 0 || save === "error"}
          title={issues ? `${issues} issue${issues > 1 ? "s" : ""} to fix first` : "Run (⌘↵)"}
          className="btn btn-sm btn-primary"
        >
          <Play size={13} strokeWidth={2.5} /> Run
        </button>
      )}
    </header>
  );
}
