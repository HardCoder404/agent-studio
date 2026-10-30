"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { diff, wordDiff } from "@/lib/diff";
import { buildTimeline, fmtMs } from "@/lib/timeline";
import type { Checkpoint, RunEvent, RunInfo } from "@/lib/types";
import { useGraphStore } from "@/store/graph";
import { useRunStore } from "@/store/run";

type Loaded = { run: RunInfo; cps: Checkpoint[]; events: RunEvent[] };

async function load(id: string): Promise<Loaded> {
  const [run, cps, events] = await Promise.all([api.getRun(id), api.getCheckpoints(id), api.getRunEvents(id)]);
  return { run, cps, events };
}

/** Two runs of the same graph side by side: final variables, cost/latency, and step lists. */
export function Compare() {
  const graphId = useGraphStore((s) => s.graphId);
  const nodes = useGraphStore((s) => s.nodes);
  const labelOf = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n.data.label])), [nodes]);
  const current = useRunStore((s) => s.runId);
  const status = useRunStore((s) => s.status);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const [a, setA] = useState<Loaded | null>(null);
  const [b, setB] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!graphId) return;
    api.listRuns(graphId).then(setRuns).catch(() => {});
  }, [graphId, status]);

  // default: A = current run, B = its parent (fork) or the previous run
  // "thing: morning walk" style summary of the run input so runs are recognisable in the pickers
  const inputLabel = (r: RunInfo) => {
    const entries = Object.entries(r.input ?? {});
    if (!entries.length) return "no input";
    return entries.slice(0, 2).map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, " ").slice(0, 28)}`).join(", ");
  };
  const effA = aId ?? current;
  const effB = useMemo(() => {
    if (bId) return bId;
    const cur = runs.find((r) => r.id === effA);
    return cur?.parent_run_id ?? runs.find((r) => r.id !== effA)?.id ?? null;
  }, [bId, effA, runs]);

  useEffect(() => {
    if (!effA) return;
    let alive = true;
    load(effA).then((l) => alive && setA(l)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [effA, status]);
  useEffect(() => {
    if (!effB) return;
    let alive = true;
    load(effB).then((l) => alive && setB(l)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [effB, status]);

  if (!runs.length) return <p className="px-3 py-2 text-xs text-muted">Run the graph at least twice (or fork a run) to compare.</p>;

  const pick = (which: "a" | "b") => (
    <select value={(which === "a" ? effA : effB) ?? ""} onChange={(e) => (which === "a" ? setAId(e.target.value) : setBId(e.target.value))} className="max-w-[16rem] rounded border border-edge bg-panel-2 px-1 py-0.5 text-[11px] text-fg">
      {runs.map((r) => (
        <option key={r.id} value={r.id} disabled={r.id === (which === "a" ? effB : effA)}>
          {new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {r.status}{r.parent_run_id ? " · fork" : ""} · {inputLabel(r)}{r.id === (which === "a" ? effB : effA) ? " (already the other side)" : ""}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1 text-[11px] text-muted">
        <span className="text-sky-300">A</span> {pick("a")}
        <span className="ml-3 text-violet-300">B</span> {pick("b")}
        <button onClick={() => { setAId(effB); setBId(effA); }} className="ml-auto rounded px-1.5 py-0.5 hover:bg-panel-3 hover:text-fg">swap</button>
      </div>
      {a && b ? <Body a={a} b={b} labelOf={labelOf} /> : <p className="px-3 py-2 text-xs text-muted">Loading…</p>}
    </div>
  );
}

function Body({ a, b, labelOf }: { a: Loaded; b: Loaded; labelOf: Record<string, string> }) {
  const ta = buildTimeline(a.events), tb = buildTimeline(b.events);
  const changes = diff(a.run.output ?? {}, b.run.output ?? {});
  const rows = Math.max(a.cps.length, b.cps.length);
  const stepName = (c?: Checkpoint) => (!c ? "" : c.forked ? "edited by hand" : c.node ? `after ${labelOf[c.node] ?? c.node}` : "run input");
  const metric = (label: string, va: string, vb: string, better?: "lower" | "higher", na?: number, nb?: number) => {
    const cls = na != null && nb != null && na !== nb ? ((better === "lower" ? nb < na : nb > na) ? "text-emerald-300" : "text-rose-300") : "text-fg";
    return (
      <tr key={label} className="border-t border-edge/60">
        <td className="py-1 pr-3 text-muted">{label}</td>
        <td className="py-1 pr-3 text-fg">{va}</td>
        <td className={`py-1 ${cls}`}>{vb}</td>
      </tr>
    );
  };
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[18rem_1fr] overflow-hidden">
      <div className="overflow-y-auto border-r border-edge px-3 py-2 text-[11px]">
        <table className="w-full">
          <thead>
            <tr className="text-muted">
              <th className="text-left font-normal">metric</th>
              <th className="text-left font-normal text-sky-300">A</th>
              <th className="text-left font-normal text-violet-300">B</th>
            </tr>
          </thead>
          <tbody>
            {metric("status", a.run.status, b.run.status)}
            {metric("total time", fmtMs(ta.total), fmtMs(tb.total), "lower", ta.total, tb.total)}
            {metric("waiting on human", fmtMs(ta.waiting), fmtMs(tb.waiting))}
            {metric("model calls", String(ta.llmCalls), String(tb.llmCalls), "lower", ta.llmCalls, tb.llmCalls)}
            {metric("cost", `$${ta.cost.toFixed(6)}`, `$${tb.cost.toFixed(6)}`, "lower", ta.cost, tb.cost)}
            {metric("steps", String(a.cps.length), String(b.cps.length))}
          </tbody>
        </table>
        <div className="mt-3 mb-1 text-muted">steps</div>
        <table className="w-full">
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i} className={`border-t border-edge/40 ${stepName(a.cps[i]) !== stepName(b.cps[i]) ? "text-amber-200" : "text-muted"}`}>
                <td className="w-5 py-0.5 text-muted/60">{i}</td>
                <td className="py-0.5 pr-2">{stepName(a.cps[i])}</td>
                <td className="py-0.5">{stepName(b.cps[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-y-auto px-3 py-2 text-[11px]">
        <div className="mb-1 text-muted">final variables · {changes.length ? `${changes.length} differ` : "identical"}</div>
        {changes.map((c) => (
          <div key={c.path} className="mb-2 rounded-md border border-edge bg-panel-2 p-2">
            <div className="mb-1 font-mono text-accent">{c.path}</div>
            {typeof c.before === "string" && typeof c.after === "string" ? (
              <p className="whitespace-pre-wrap leading-relaxed text-fg">
                {wordDiff(c.before, c.after).map(([k, t], i) => (
                  <span key={i} className={k === "del" ? "bg-sky-500/25 text-sky-100 line-through" : k === "ins" ? "bg-violet-500/25 text-violet-100" : ""}>
                    {t}
                  </span>
                ))}
              </p>
            ) : (
              <>
                <pre className="whitespace-pre-wrap text-sky-200/90">A {JSON.stringify(c.before)}</pre>
                <pre className="whitespace-pre-wrap text-violet-200/90">B {JSON.stringify(c.after)}</pre>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
