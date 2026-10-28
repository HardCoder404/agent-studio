"use client";

import { BarChart3, ChevronDown, ChevronUp, Coins, FlaskConical, GitCompare, History, Plug, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { RunEvent, RunInfo } from "@/lib/types";
import { Compare } from "@/components/panel/Compare";
import { Cost } from "@/components/panel/Cost";
import { Evals } from "@/components/panel/Evals";
import { Timeline } from "@/components/panel/Timeline";
import { Tools } from "@/components/panel/Tools";
import { useGraphStore } from "@/store/graph";
import { useRunStore } from "@/store/run";

const typeColor: Record<string, string> = {
  run_start: "text-emerald-300",
  run_resume: "text-emerald-300",
  run_end: "text-emerald-300",
  run_error: "text-rose-300",
  run_cancelled: "text-amber-300",
  interrupt: "text-pink-300",
  retry: "text-amber-300",
  run_fork: "text-violet-300",
  node_start: "text-sky-300",
  node_end: "text-sky-300",
  checkpoint: "text-muted/60",
  status: "text-muted/60",
};

function summary(e: RunEvent): string {
  switch (e.type) {
    case "run_start":
      return `input ${JSON.stringify(e.input ?? {})}`;
    case "run_resume":
      return `resumed with ${JSON.stringify(e.value)}`;
    case "node_end": {
      const u = e.usage ?? {};
      const bits = [u.latency_ms != null && `${u.latency_ms} ms`, u.output_tokens != null && `${u.input_tokens}→${u.output_tokens} tok`, u.cost_usd != null && `$${u.cost_usd}`].filter(Boolean);
      const out = e.output ? Object.entries(e.output).map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.length > 80 ? v.slice(0, 79) + "…" : v) : JSON.stringify(v)}`).join(" ") : "";
      return [bits.join(" · "), out].filter(Boolean).join("  ");
    }
    case "interrupt":
      return e.question ?? "";
    case "retry":
      return `attempt ${e.attempt} · waiting ${e.wait_s}s · ${e.reason ?? ""}`;
    case "run_end": {
      const u = e.usage ?? {};
      return `done · ${u.llm_calls ?? 0} calls · ${u.input_tokens ?? 0}→${u.output_tokens ?? 0} tok · $${u.cost_usd ?? 0}`;
    }
    case "run_error":
      return e.error ?? "";
    case "checkpoint":
      return `checkpoint ${String(e.checkpoint_id ?? "").slice(0, 8)}`;
    case "status":
      return e.status ?? "";
    default:
      return "";
  }
}

function Console() {
  const events = useRunStore((s) => s.events);
  const runId = useRunStore((s) => s.runId);
  const [filter, setFilter] = useState<string>("");
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  const nodes = [...new Set(events.map((e) => e.node).filter(Boolean))] as string[];
  const shown = events.filter((e) => (!filter || e.node === filter) && (showCheckpoints || (e.type !== "checkpoint" && e.type !== "status")));

  if (!runId) return <p className="px-3 py-2 text-xs text-muted">Run the graph to see events here.</p>;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1 text-[11px] text-muted">
        <span className="font-mono">{runId.slice(0, 8)}</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="input w-auto px-1.5 py-0.5 text-[11px]">
          <option value="">all nodes</option>
          {nodes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showCheckpoints} onChange={(e) => setShowCheckpoints(e.target.checked)} /> checkpoints
        </label>
        <span className="ml-auto">{shown.length} events</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1 font-mono text-[11px] leading-5">
        {shown.map((e, i) => (
          <div key={`${e.seq ?? "l"}-${i}`} className="flex gap-2">
            <span className="w-8 shrink-0 text-right text-muted/50">{e.seq ?? ""}</span>
            <span className={`w-24 shrink-0 ${typeColor[e.type] ?? "text-fg"}`}>{e.type}</span>
            <span className="w-20 shrink-0 truncate text-muted">{e.node ?? ""}</span>
            <span className="min-w-0 flex-1 truncate text-fg/90" title={summary(e)}>
              {summary(e)}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

const statusColor: Record<string, string> = { done: "text-emerald-300", error: "text-rose-300", paused: "text-pink-300", running: "text-sky-300", cancelled: "text-amber-300" };

function Runs() {
  const graphId = useGraphStore((s) => s.graphId);
  const current = useRunStore((s) => s.runId);
  const status = useRunStore((s) => s.status);
  const [runs, setRuns] = useState<RunInfo[]>([]);

  useEffect(() => {
    if (!graphId) return;
    api.listRuns(graphId).then(setRuns).catch(() => {});
  }, [graphId, current, status]);

  const open = async (r: RunInfo) => {
    const store = useRunStore.getState();
    store.begin(r.id, r.status); // the socket replays the persisted events from seq 0
  };

  if (!runs.length) return <p className="px-3 py-2 text-xs text-muted">No runs yet.</p>;

  // order as a tree: each run followed by its forks, depth for indentation
  const byParent = new Map<string | null, RunInfo[]>();
  for (const r of runs) byParent.set(r.parent_run_id, [...(byParent.get(r.parent_run_id) ?? []), r]);
  const ordered: { run: RunInfo; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      ordered.push({ run: r, depth });
      visit(r.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const r of runs) if (!ordered.some((o) => o.run.id === r.id)) ordered.push({ run: r, depth: 0 }); // parent outside the page

  return (
    <ul className="divide-y divide-edge overflow-y-auto text-xs">
      {ordered.map(({ run: r, depth }) => (
        <li key={r.id} onClick={() => open(r)} className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 transition hover:bg-panel-2 ${r.id === current ? "bg-accent/5" : ""}`} style={{ paddingLeft: 12 + depth * 18 }}>
          {depth > 0 && <span className="text-violet-300" title="forked run">⑂</span>}
          <span className="font-mono text-muted">{r.id.slice(0, 8)}</span>
          <span className={`w-16 ${statusColor[r.status] ?? "text-muted"}`}>{r.status}</span>
          <span className="w-24 text-muted">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : ""}</span>
          <span className="w-28 text-muted">{r.usage?.llm_calls != null ? `${r.usage.llm_calls} calls · $${r.usage.cost_usd}` : ""}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{JSON.stringify(r.input)}</span>
          <span className="text-muted/70">{new Date(r.created_at).toLocaleTimeString()}</span>
        </li>
      ))}
    </ul>
  );
}

export function BottomPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"timeline" | "console" | "runs" | "compare" | "evals" | "cost" | "tools">("timeline");
  const runId = useRunStore((s) => s.runId);
  const status = useRunStore((s) => s.status);

  // pop open whenever a new run starts (state adjusted during render, no effect needed)
  const [seenRun, setSeenRun] = useState(runId);
  if (runId !== seenRun) {
    setSeenRun(runId);
    if (runId) setOpen(true);
  }

  const statusTone: Record<string, string> = { done: "bg-emerald-400", error: "bg-rose-400", paused: "bg-pink-400", running: "bg-sky-400", cancelled: "bg-amber-400", queued: "bg-zinc-500" };

  return (
    <section className={`flex shrink-0 flex-col border-t border-edge bg-panel transition-[height] ${open ? (tab === "evals" || tab === "tools" ? "h-96" : "h-72") : "h-10"}`}>
      <div className="flex h-10 shrink-0 items-stretch gap-0.5 border-b border-edge px-2 text-xs">
        <button onClick={() => setOpen((o) => !o)} className="icon-btn my-auto" title={open ? "Collapse" : "Expand"}>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        {(
          [
            ["timeline", BarChart3, "Timeline"],
            ["console", Terminal, "Console"],
            ["runs", History, "Runs"],
            ["compare", GitCompare, "Compare"],
            ["evals", FlaskConical, "Evals"],
            ["cost", Coins, "Cost"],
            ["tools", Plug, "Tools"],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            data-active={tab === id && open}
            onClick={() => {
              setTab(id);
              setOpen(true);
            }}
            className={`tab-underline flex items-center gap-1.5 px-2.5 text-[12px] font-medium transition ${tab === id && open ? "text-fg" : "text-muted hover:text-fg"}`}
          >
            <Icon size={12} className={tab === id && open ? "text-accent" : ""} /> {label}
          </button>
        ))}
        {status && (
          <span className="pill my-auto ml-auto border border-edge-2 bg-panel-2 text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${statusTone[status] ?? "bg-zinc-500"}`} /> {status}
          </span>
        )}
      </div>
      {open && <div className="min-h-0 flex-1">{tab === "timeline" ? <Timeline /> : tab === "console" ? <Console /> : tab === "runs" ? <Runs /> : tab === "compare" ? <Compare /> : tab === "evals" ? <Evals /> : tab === "cost" ? <Cost /> : <Tools />}</div>}
    </section>
  );
}
