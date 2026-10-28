"use client";

import { ChevronLeft, ChevronRight, GitBranch, Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { diff, wordDiff, type Change } from "@/lib/diff";
import type { Checkpoint } from "@/lib/types";
import { useGraphStore } from "@/store/graph";
import { isTerminal, useRunStore } from "@/store/run";

/** Checkpoint scrubber: pick any step of the run, see the state there and what that step changed. */
export function StatePanel() {
  const runId = useRunStore((s) => s.runId);
  const status = useRunStore((s) => s.status);
  const lastSeq = useRunStore((s) => s.lastSeq);
  const cps = useRunStore((s) => s.checkpoints);
  const cpsFor = useRunStore((s) => s.checkpointsFor);
  const replayIndex = useRunStore((s) => s.replayIndex);
  const setReplayIndex = useRunStore((s) => s.setReplayIndex);
  const nodes = useGraphStore((s) => s.nodes);
  const labelOf = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n.data.label])), [nodes]);
  const [mode, setMode] = useState<"diff" | "state">("diff");
  const [forking, setForking] = useState(false);

  // refresh the checkpoint list whenever the run moves (cheap: one query per step)
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    api.getCheckpoints(runId).then((list) => alive && useRunStore.getState().setCheckpoints(runId, list)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [runId, lastSeq, status]);

  const list = cpsFor === runId ? cps : [];
  const index = replayIndex ?? list.length - 1;
  const cp: Checkpoint | undefined = list[index];
  const prev: Checkpoint | undefined = list[index - 1];
  const changes = useMemo(() => (cp ? diff(prev?.vars ?? {}, cp.vars) : []), [cp, prev]);
  const live = replayIndex === null;

  if (!runId) return <p className="px-4 text-sm text-muted">Run the graph to inspect its state.</p>;
  if (!list.length) {
    return <p className="px-4 text-sm text-muted">{cpsFor === runId ? "No checkpoints are stored for this run." : "Loading checkpoints…"}</p>;
  }

  const go = (i: number) => {
    const clamped = Math.max(0, Math.min(list.length - 1, i));
    setReplayIndex(clamped === list.length - 1 && isTerminal(status) ? null : clamped);
  };

  return (
    <div className="flex h-full flex-col">
      {/* scrubber */}
      <div className="px-4">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
          <span>
            step <b className="text-fg">{index}</b> / {list.length - 1}
          </span>
          <button onClick={() => setReplayIndex(null)} className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${live ? "text-emerald-300" : "text-muted hover:text-fg"}`} title="Follow the live run">
            <Radio size={11} /> live
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => go(index - 1)} disabled={index <= 0} className="rounded p-1 text-muted hover:text-fg disabled:opacity-30">
            <ChevronLeft size={14} />
          </button>
          <input type="range" min={0} max={list.length - 1} value={index} onChange={(e) => go(Number(e.target.value))} className="flex-1 accent-(--accent)" />
          <button onClick={() => go(index + 1)} disabled={index >= list.length - 1} className="rounded p-1 text-muted hover:text-fg disabled:opacity-30">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* step list */}
      <ol className="mx-4 mt-2 max-h-36 overflow-y-auto rounded-md border border-edge bg-panel-2 text-[11px]">
        {list.map((c, i) => (
          <li key={c.checkpoint_id} onClick={() => go(i)} className={`flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-panel-3 ${i === index ? "bg-panel-3 text-fg" : "text-muted"}`}>
            <span className="w-5 text-right text-muted/60">{i}</span>
            <span className="min-w-0 flex-1 truncate">{c.forked ? <span className="text-violet-300">edited by hand</span> : c.node ? `after ${labelOf[c.node] ?? c.node}` : "run input"}</span>
            {c.interrupted && <span className="text-pink-300">paused</span>}
            {c.next.length > 0 && <span className="text-muted/60">→ {c.next.map((n) => labelOf[n] ?? n).join(", ")}</span>}
          </li>
        ))}
      </ol>

      {/* mode */}
      <div className="mx-4 mt-3 grid grid-cols-2 gap-1 rounded-md border border-edge bg-panel-2 p-1 text-xs">
        {(["diff", "state"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded px-2 py-1 ${mode === m ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"}`}>
            {m === "diff" ? `what changed (${changes.length})` : "full state"}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {cp && cp.next.length > 0 && !forking && (
          <button onClick={() => setForking(true)} className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20">
            <GitBranch size={13} /> Edit state & fork from step {index}
          </button>
        )}
        {cp && forking && <ForkEditor runId={runId} checkpoint={cp} onClose={() => setForking(false)} />}
        {mode === "state" ? <JsonView value={cp?.vars ?? {}} /> : <ChangeList changes={changes} />}
        {cp && cp.trace.length > 0 && mode === "state" && (
          <div className="mt-3 text-[11px] text-muted">
            trace entries <b className="text-fg">{cp.trace.length}</b> · checkpoint <span className="font-mono">{cp.checkpoint_id.slice(0, 8)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ChangeList({ changes }: { changes: Change[] }) {
  if (!changes.length) return <p className="text-xs text-muted">No variables changed in this step.</p>;
  return (
    <ul className="space-y-2">
      {changes.map((c) => (
        <li key={c.path} className="rounded-md border border-edge bg-panel-2 p-2 text-[11px]">
          <div className="mb-1 flex items-center gap-2">
            <span className={`rounded px-1 text-[10px] uppercase ${c.kind === "added" ? "bg-emerald-500/20 text-emerald-200" : c.kind === "removed" ? "bg-rose-500/20 text-rose-200" : "bg-accent/15 text-accent"}`}>{c.kind}</span>
            <span className="font-mono text-accent">{c.path}</span>
          </div>
          {c.kind === "changed" && typeof c.before === "string" && typeof c.after === "string" ? (
            <p className="whitespace-pre-wrap leading-relaxed text-fg">
              {wordDiff(c.before, c.after).map(([k, t], i) => (
                <span key={i} className={k === "del" ? "bg-rose-500/25 text-rose-200 line-through" : k === "ins" ? "bg-emerald-500/25 text-emerald-100" : ""}>
                  {t}
                </span>
              ))}
            </p>
          ) : (
            <div className="space-y-1">
              {c.kind !== "added" && <pre className="whitespace-pre-wrap text-rose-200/90">- {fmt(c.before)}</pre>}
              {c.kind !== "removed" && <pre className="whitespace-pre-wrap text-emerald-200/90">+ {fmt(c.after)}</pre>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

const fmt = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

function JsonView({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  if (!entries.length) return <p className="text-xs text-muted">Empty state.</p>;
  return (
    <dl className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-md border border-edge bg-panel-2 p-2 text-[11px]">
          <dt className="mb-0.5 font-mono text-accent">{k}</dt>
          <dd className="whitespace-pre-wrap text-fg">{fmt(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline editor for the variables at a checkpoint; submitting creates a forked run. */
function ForkEditor({ runId, checkpoint, onClose }: { runId: string; checkpoint: Checkpoint; onClose: () => void }) {
  const [text, setText] = useState(() => JSON.stringify(checkpoint.vars, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    let vars: Record<string, unknown>;
    try {
      vars = JSON.parse(text);
    } catch {
      setError("not valid JSON");
      return;
    }
    // send only what changed, so untouched keys keep their checkpoint values
    const patch = Object.fromEntries(Object.entries(vars).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(checkpoint.vars[k])));
    setBusy(true);
    try {
      const run = await api.forkRun(runId, checkpoint.checkpoint_id, patch);
      useRunStore.getState().begin(run.id, run.status);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-md border border-violet-500/40 bg-violet-500/5 p-2">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-medium text-violet-200">Edit variables, then continue from here in a new run</span>
        <button onClick={onClose} className="text-muted hover:text-fg">×</button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} className="w-full rounded-md border border-edge bg-panel-2 p-2 font-mono text-[11px] text-fg outline-none focus:border-violet-500/60" />
      {error && <p className="mt-1 text-[11px] text-rose-300">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-2 py-1 text-xs text-muted hover:text-fg">Cancel</button>
        <button onClick={submit} disabled={busy} className="flex items-center gap-1 rounded-md bg-violet-500/25 px-3 py-1 text-xs font-medium text-violet-100 hover:bg-violet-500/35 disabled:opacity-50">
          <GitBranch size={12} /> {busy ? "Forking…" : "Fork & run"}
        </button>
      </div>
    </div>
  );
}
