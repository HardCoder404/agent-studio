"use client";

import { Flame, Play, Plus, Square, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { allKeys, inputKeys } from "@/lib/graphUtils";
import type { Dataset, DatasetRow, EvalResultRow, EvalRunInfo, ScorerKind, ScorerSpec, Sweep } from "@/lib/types";
import { useModels } from "@/lib/useCatalog";
import { useGraphStore } from "@/store/graph";
import { useRunStore } from "@/store/run";

const kinds: { kind: ScorerKind; label: string; hint: string }[] = [
  { kind: "contains", label: "contains", hint: "expected text (or list) appears in the output" },
  { kind: "exact", label: "exact", hint: "output equals expected (case-insensitive)" },
  { kind: "regex", label: "regex", hint: "output matches a pattern" },
  { kind: "json_valid", label: "json", hint: "output parses as JSON with required keys" },
  { kind: "max_length", label: "max length", hint: "output is at most N characters" },
  { kind: "llm_judge", label: "LLM judge", hint: "a model grades the output against a rubric (costs tokens)" },
];

/** Datasets, scorers, eval runs and results for the current graph. */
export function Evals() {
  const graphId = useGraphStore((s) => s.graphId);
  const nodes = useGraphStore((s) => s.nodes);
  const issues = useGraphStore((s) => s.issues.length);
  const outputs = useMemo(() => allKeys(nodes), [nodes]);
  const inputs = useMemo(() => inputKeys(nodes), [nodes]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [dsId, setDsId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [scorers, setScorers] = useState<ScorerSpec[]>([{ kind: "contains", key: outputs[0] ?? "output" }]);
  const [evals, setEvals] = useState<EvalRunInfo[]>([]);
  const [open, setOpen] = useState<(EvalRunInfo & { results: EvalResultRow[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setHeat = useRunStore((s) => s.setHeat);
  const [sweep, setSweep] = useState<Sweep | null>(null);

  const refresh = useCallback(() => {
    if (!graphId) return Promise.resolve();
    return Promise.all([api.listDatasets(graphId), api.listEvals(graphId)]).then(([d, e]) => {
      setDatasets(d);
      setEvals(e);
      setDsId((cur) => cur ?? d[0]?.id ?? null);
    });
  }, [graphId]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // poll while something is running
  const running = evals.some((e) => e.status === "running" || e.status === "queued") || open?.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = setInterval(async () => {
      await refresh().catch(() => {});
      if (open) setOpen(await api.getEval(open.id).catch(() => open));
    }, 1500);
    return () => clearInterval(id);
  }, [running, refresh, open]);

  const start = async () => {
    if (!graphId || !dsId) return;
    setError(null);
    try {
      const ev = await api.createEval({ graph_id: graphId, dataset_id: dsId, scorers });
      setEvals((e) => [ev, ...e]);
      setOpen({ ...ev, results: [] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const openEval = async (id: string) => {
    const ev = await api.getEval(id);
    setSweep(null);
    setOpen(ev);
    setHeat(ev.summary && "node_failure_share" in ev.summary ? ev.summary.node_failure_share : null);
  };

  if (!graphId) return null;
  const ds = datasets.find((d) => d.id === dsId) ?? null;

  return (
    <div className="grid h-full grid-cols-[20rem_1fr] overflow-hidden">
      {/* left: dataset + scorers */}
      <div className="flex flex-col gap-3 overflow-y-auto border-r border-edge px-3 py-2 text-[11px]">
        <div>
          <div className="mb-1 flex items-center justify-between text-muted">
            <span>Dataset</span>
            <div className="flex gap-1">
              <button onClick={() => setEditing(true)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-panel-3">
                <Plus size={11} /> {ds ? "edit" : "new"}
              </button>
              {ds && (
                <button onClick={() => api.deleteDataset(ds.id).then(() => { setDsId(null); refresh(); })} className="rounded px-1 py-0.5 text-muted hover:text-rose-400" title="Delete dataset">
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </div>
          <select value={dsId ?? ""} onChange={(e) => setDsId(e.target.value)} className="w-full rounded border border-edge bg-panel-2 px-1.5 py-1 text-fg">
            {!datasets.length && <option value="">no datasets yet</option>}
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.rows.length} rows
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-muted">
            <span>Scorers</span>
            <button onClick={() => setScorers((s) => [...s, { kind: "contains", key: outputs[0] ?? "output" }])} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-panel-3">
              <Plus size={11} /> add
            </button>
          </div>
          <div className="space-y-1.5">
            {scorers.map((sc, i) => (
              <ScorerEditor key={i} spec={sc} outputs={outputs} onChange={(p) => setScorers((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)))} onRemove={() => setScorers((s) => s.filter((_, j) => j !== i))} />
            ))}
          </div>
        </div>

        <button onClick={start} disabled={!ds || !ds.rows.length || !scorers.length || issues > 0} title={issues ? "fix graph issues first" : undefined} className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">
          <Play size={12} /> Run eval{ds ? ` on ${ds.rows.length} rows` : ""}
        </button>
        {error && <p className="text-rose-300">{error}</p>}

        <SweepLauncher graphId={graphId} dsId={dsId} scorers={scorers} disabled={!ds || !ds.rows.length || !scorers.length || issues > 0} onStarted={(sw) => { setOpen(null); setSweep(sw); }} />

        <div>
          <div className="mb-1 text-muted">Past evals</div>
          <ul className="divide-y divide-edge rounded-md border border-edge bg-panel-2">
            {!evals.length && <li className="px-2 py-1 text-muted">none yet</li>}
            {evals.map((e) => (
              <li key={e.id} onClick={() => openEval(e.id)} className={`flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-panel-3 ${open?.id === e.id ? "bg-panel-3" : ""}`}>
                <span className={{ done: "text-emerald-300", error: "text-rose-300", running: "text-sky-300", queued: "text-muted", cancelled: "text-amber-300" }[e.status]}>{e.status}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{e.dataset_name ?? "dataset"} · v{e.graph_version}</span>
                <span className="text-fg">{e.status === "done" && "pass_rate" in e.summary ? `${Math.round(((e.summary.pass_rate as number) ?? 0) * 100)}%` : `${e.completed}/${e.total}`}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* right: results */}
      <div className="min-h-0 overflow-y-auto">
        {editing && graphId && <DatasetEditor graphId={graphId} dataset={ds} inputs={inputs} onDone={(d) => { setEditing(false); if (d) setDsId(d.id); refresh(); }} />}
        {!editing && !open && !sweep && <p className="px-3 py-2 text-xs text-muted">Pick a dataset and scorers, then run an eval. Results and the node heatmap appear here.</p>}
        {!editing && open && <Results ev={open} onCancel={() => api.cancelEval(open.id).catch(() => {})} />}
        {!editing && !open && sweep && <SweepView sweep={sweep} onRefresh={(sw) => setSweep(sw)} onOpenVariant={(id) => { setSweep(null); openEval(id); }} />}
      </div>
    </div>
  );
}

function ScorerEditor({ spec, outputs, onChange, onRemove }: { spec: ScorerSpec; outputs: string[]; onChange: (p: Partial<ScorerSpec>) => void; onRemove: () => void }) {
  const meta = kinds.find((k) => k.kind === spec.kind)!;
  const field = "w-full rounded border border-edge bg-panel-2 px-1.5 py-0.5 text-fg";
  return (
    <div className="rounded-md border border-edge bg-panel-2/60 p-1.5" title={meta.hint}>
      <div className="flex items-center gap-1">
        <select value={spec.kind} onChange={(e) => onChange({ kind: e.target.value as ScorerKind, ...(e.target.value === "max_length" ? { max_chars: spec.max_chars ?? 280 } : {}) })} className={field}>
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <select value={spec.key} onChange={(e) => onChange({ key: e.target.value })} className={field} title="output variable to grade">
          {[...new Set([spec.key, ...outputs])].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button onClick={onRemove} className="rounded p-1 text-muted hover:text-rose-400">
          <Trash2 size={11} />
        </button>
      </div>
      {spec.kind === "regex" && <input value={spec.pattern ?? ""} onChange={(e) => onChange({ pattern: e.target.value })} placeholder="pattern" className={`${field} mt-1 font-mono`} />}
      {spec.kind === "max_length" && <input type="number" value={spec.max_chars ?? 280} onChange={(e) => onChange({ max_chars: Number(e.target.value) })} className={`${field} mt-1`} />}
      {spec.kind === "json_valid" && <input value={(spec.required_keys ?? []).join(",")} onChange={(e) => onChange({ required_keys: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="required keys, comma separated" className={`${field} mt-1 font-mono`} />}
      {spec.kind === "llm_judge" && (
        <>
          <textarea value={spec.rubric ?? ""} onChange={(e) => onChange({ rubric: e.target.value })} placeholder="rubric" rows={2} className={`${field} mt-1`} />
          <div className="mt-1 flex items-center gap-1 text-muted">
            pass ≥ <input type="number" step={0.1} min={0} max={1} value={spec.pass_threshold ?? 0.7} onChange={(e) => onChange({ pass_threshold: Number(e.target.value) })} className={`${field} !w-16`} />
          </div>
        </>
      )}
    </div>
  );
}

function DatasetEditor({ graphId, dataset, inputs, onDone }: { graphId: string; dataset: Dataset | null; inputs: string[]; onDone: (d: Dataset | null) => void }) {
  const starter: DatasetRow[] = dataset?.rows ?? [{ input: Object.fromEntries(inputs.map((k) => [k, ""])), expected: "", human: "yes" }];
  const [name, setName] = useState(dataset?.name ?? "dataset");
  const [text, setText] = useState(() => JSON.stringify(starter, null, 2));
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    let rows: DatasetRow[];
    try {
      rows = JSON.parse(text);
      if (!Array.isArray(rows)) throw new Error("must be an array of rows");
    } catch (e) {
      setError(e instanceof Error ? e.message : "invalid JSON");
      return;
    }
    try {
      const d = dataset ? await api.updateDataset(dataset.id, { name, rows }) : await api.createDataset({ graph_id: graphId, name, rows });
      onDone(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-edge bg-panel-2 px-2 py-1 text-fg" />
        <span className="text-muted">
          rows are <span className="font-mono">{"{ input: {"}{inputs.map((k) => `${k}`).join(", ") || "…"}{"}, expected, human }"}</span>; <span className="font-mono">human</span> answers human nodes so the eval runs unattended
        </span>
        <button onClick={save} className="ml-auto rounded-md bg-sky-500/20 px-3 py-1 text-sky-200 hover:bg-sky-500/30">Save</button>
        <button onClick={() => onDone(null)} className="rounded px-2 py-1 text-muted hover:text-fg">Cancel</button>
      </div>
      {error && <p className="text-rose-300">{error}</p>}
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="min-h-0 flex-1 rounded-md border border-edge bg-panel-2 p-2 font-mono text-[11px] text-fg outline-none focus:border-accent/55" />
    </div>
  );
}

function Results({ ev, onCancel }: { ev: EvalRunInfo & { results: EvalResultRow[] }; onCancel: () => void }) {
  const names = Object.keys(ev.scorers.length ? Object.fromEntries(ev.scorers.map((s) => [`${s.kind}:${s.key}`, 1])) : {});
  const s = "pass_rate" in ev.summary ? ev.summary : null;
  const heat = useRunStore((st) => st.heat);
  const setHeat = useRunStore((st) => st.setHeat);
  const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);
  return (
    <div className="text-[11px]">
      <div className="flex flex-wrap items-center gap-4 border-b border-edge px-3 py-1.5">
        <span className={{ done: "text-emerald-300", error: "text-rose-300", running: "text-sky-300", queued: "text-muted", cancelled: "text-amber-300" }[ev.status]}>{ev.status}</span>
        <span className="text-muted">
          {ev.completed}/{ev.total} rows
        </span>
        {s && (
          <>
            <span>
              pass <b className="text-fg">{pct(s.pass_rate)}</b>
            </span>
            {Object.entries(s.scorers).map(([n, v]) => (
              <span key={n} className="text-muted">
                {n} <b className="text-fg">{pct(v.pass_rate)}</b>
              </span>
            ))}
            <span className="text-muted">
              cost <b className="text-fg">${s.cost_usd}</b> · avg <b className="text-fg">{(s.avg_duration_ms / 1000).toFixed(1)} s</b>
            </span>
            {Object.keys(s.node_failure_share).length > 0 && (
              <button onClick={() => setHeat(heat ? null : s.node_failure_share)} className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${heat ? "bg-amber-500/20 text-amber-200" : "text-muted hover:text-fg"}`} title="Colour nodes by their share of failed rows">
                <Flame size={11} /> heatmap
              </button>
            )}
          </>
        )}
        {ev.status === "running" && (
          <button onClick={onCancel} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-rose-300 hover:bg-panel-3">
            <Square size={11} /> stop
          </button>
        )}
        {ev.error && <span className="text-rose-300">{ev.error}</span>}
      </div>
      <table className="w-full">
        <thead className="text-muted">
          <tr>
            <th className="px-3 py-1 text-left font-normal">#</th>
            <th className="py-1 text-left font-normal">input</th>
            <th className="py-1 text-left font-normal">output</th>
            {names.map((n) => (
              <th key={n} className="py-1 text-left font-normal">
                {n}
              </th>
            ))}
            <th className="py-1 text-left font-normal">cost</th>
            <th className="py-1 pr-3 text-left font-normal">time</th>
          </tr>
        </thead>
        <tbody>
          {ev.results.map((r) => (
            <tr key={r.row_index} className="border-t border-edge/60 align-top">
              <td className="px-3 py-1 text-muted">{r.row_index}</td>
              <td className="max-w-[14rem] truncate py-1 text-muted" title={JSON.stringify(r.input)}>{JSON.stringify(r.input)}</td>
              <td className="max-w-[22rem] py-1 text-fg" title={JSON.stringify(r.output)}>
                {r.error ? <span className="text-rose-300">{r.error}</span> : <span className="line-clamp-2">{r.output ? String(r.output[ev.scorers[0]?.key ?? ""] ?? JSON.stringify(r.output)) : ""}</span>}
              </td>
              {names.map((n) => {
                const sc = r.scores[n];
                return (
                  <td key={n} className="py-1" title={sc?.detail}>
                    {sc ? <span className={sc.passed ? "text-emerald-300" : "text-rose-300"}>{sc.passed ? "✓" : "✗"} {sc.score.toFixed(2)}</span> : <span className="text-muted">–</span>}
                  </td>
                );
              })}
              <td className="py-1 text-muted">${((r.usage?.cost_usd ?? 0) + (r.usage?.judge_cost_usd ?? 0)).toFixed(6)}</td>
              <td className="py-1 pr-3 text-muted">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pick an LLM node and candidate models; runs one eval per model so they can be ranked. */
function SweepLauncher({ graphId, dsId, scorers, disabled, onStarted }: { graphId: string; dsId: string | null; scorers: ScorerSpec[]; disabled: boolean; onStarted: (s: Sweep) => void }) {
  const nodes = useGraphStore((s) => s.nodes);
  const llmNodes = nodes.filter((n) => n.type === "llm");
  const models = useModels().filter((m) => m.available);
  const [nodeId, setNodeId] = useState<string>(llmNodes[0]?.id ?? "");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = picked ?? models.slice(0, 3).map((m) => m.id);

  const start = async () => {
    if (!dsId || !nodeId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createSweep({ graph_id: graphId, dataset_id: dsId, scorers, node_id: nodeId, models: chosen });
      onStarted({ sweep_id: r.sweep_id, node_id: r.node_id, variants: r.evals, recommended: null, done: false });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!llmNodes.length) return null;
  return (
    <div className="rounded-md border border-edge bg-panel-2/60 p-2">
      <div className="mb-1 flex items-center gap-1 text-muted">
        <Zap size={11} className="text-amber-300" /> Model sweep
        <span className="ml-auto text-[10px] text-muted/70">same eval, one run per model</span>
      </div>
      <select value={nodeId} onChange={(e) => setNodeId(e.target.value)} className="mb-1 w-full rounded border border-edge bg-panel-2 px-1.5 py-0.5 text-fg">
        {llmNodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.data.label}
          </option>
        ))}
      </select>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {models.map((m) => {
          const on = chosen.includes(m.id);
          return (
            <button key={m.id} onClick={() => setPicked(on ? chosen.filter((x) => x !== m.id) : [...chosen, m.id])} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${on ? "bg-amber-500/20 text-amber-200" : "bg-panel-3 text-muted hover:text-fg"}`} title={`${m.tier} · $${m.input_per_m}/$${m.output_per_m} per 1M`}>
              {m.id.replace(/^groq\//, "")}
            </button>
          );
        })}
      </div>
      <button onClick={start} disabled={disabled || busy || !chosen.length} className="flex w-full items-center justify-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-amber-200 hover:bg-amber-500/25 disabled:opacity-40">
        <Zap size={11} /> {busy ? "Starting…" : `Sweep ${chosen.length} models`}
      </button>
      {error && <p className="mt-1 text-rose-300">{error}</p>}
    </div>
  );
}

/** Ranked table of sweep variants with a one-click "apply" that sets the node's model. */
function SweepView({ sweep, onRefresh, onOpenVariant }: { sweep: Sweep; onRefresh: (s: Sweep) => void; onOpenVariant: (id: string) => void }) {
  const updateConfig = useGraphStore((s) => s.updateConfig);
  const label = useGraphStore((s) => s.nodes.find((n) => n.id === sweep.node_id)?.data.label ?? sweep.node_id);
  const current = useGraphStore((s) => (s.nodes.find((n) => n.id === sweep.node_id)?.data.config as { model?: string } | undefined)?.model);

  useEffect(() => {
    if (sweep.done) return;
    const id = setInterval(() => api.getSweep(sweep.sweep_id).then(onRefresh).catch(() => {}), 1500);
    return () => clearInterval(id);
  }, [sweep.sweep_id, sweep.done, onRefresh]);

  const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);
  return (
    <div className="text-[11px]">
      <div className="flex items-center gap-3 border-b border-edge px-3 py-1.5">
        <Zap size={12} className="text-amber-300" />
        <span className="text-fg">sweep · {label}</span>
        <span className="text-muted">{sweep.done ? "done" : "running…"}</span>
        {sweep.recommended && (
          <span className="ml-auto text-muted">
            recommended <b className="font-mono text-emerald-300">{sweep.recommended.replace(/^groq\//, "")}</b> <span className="text-muted/70">(cheapest within 5 pts of the best pass rate)</span>
          </span>
        )}
      </div>
      <table className="w-full">
        <thead className="text-muted">
          <tr>
            <th className="px-3 py-1 text-left font-normal">model</th>
            <th className="py-1 text-left font-normal">status</th>
            <th className="py-1 text-right font-normal">pass</th>
            <th className="py-1 text-right font-normal">cost / dataset</th>
            <th className="py-1 text-right font-normal">avg time</th>
            <th className="py-1 pr-3 text-right font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {sweep.variants.map((v) => {
            const s = "pass_rate" in v.summary ? v.summary : null;
            const rec = v.variant === sweep.recommended;
            return (
              <tr key={v.id} className={`border-t border-edge/60 ${rec ? "bg-emerald-500/5" : ""}`}>
                <td className="px-3 py-1 font-mono text-fg">
                  {v.variant?.replace(/^groq\//, "")} {v.variant === current && <span className="text-muted">(current)</span>} {rec && <span className="text-emerald-300">★</span>}
                </td>
                <td className="py-1 text-muted">{v.status}{v.status === "running" ? ` ${v.completed}/${v.total}` : ""}</td>
                <td className="py-1 text-right text-fg">{pct(s?.pass_rate)}</td>
                <td className="py-1 text-right text-muted">{s ? `$${s.cost_usd.toFixed(6)}` : "–"}</td>
                <td className="py-1 text-right text-muted">{s ? `${(s.avg_duration_ms / 1000).toFixed(1)} s` : "–"}</td>
                <td className="py-1 pr-3 text-right">
                  <button onClick={() => onOpenVariant(v.id)} className="mr-2 text-muted hover:text-fg">rows</button>
                  {v.variant && v.variant !== current && v.status === "done" && (
                    <button onClick={() => updateConfig(sweep.node_id, { model: v.variant })} className="rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-200 hover:bg-sky-500/30">apply</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
