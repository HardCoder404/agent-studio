"use client";

import { useEffect, useMemo, useState } from "react";
import { buildTimeline, fmtMs, type Span } from "@/lib/timeline";
import type { NodeType } from "@/lib/types";
import { useGraphStore } from "@/store/graph";
import { isTerminal, useRunStore } from "@/store/run";

const WAIT_STRIPES = "repeating-linear-gradient(135deg, rgb(244 114 182 / 0.6) 0 4px, rgb(244 114 182 / 0.2) 4px 8px)";

const toneByType: Record<NodeType, string> = {
  start: "#34d399",
  end: "#fb7185",
  llm: "#38bdf8",
  tool: "#fbbf24",
  router: "#a78bfa",
  human: "#f472b6",
  code: "#2dd4bf",
};

/** Waterfall of node spans for the current run. Click a bar to select the node and see the step. */
export function Timeline() {
  const events = useRunStore((s) => s.events);
  const status = useRunStore((s) => s.status);
  const runId = useRunStore((s) => s.runId);
  const nodes = useGraphStore((s) => s.nodes);
  const select = useGraphStore((s) => s.select);
  const [picked, setPicked] = useState<Span | null>(null);
  const [tick, setTick] = useState(0);

  // keep open bars growing while the run is live
  const live = !!runId && !isTerminal(status);
  useEffect(() => {
    if (!live) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!id) id = setInterval(() => setTick((t) => t + 1), 250); };
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [live]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick forces a recompute of open spans
  const tl = useMemo(() => buildTimeline(events), [events, tick]);
  const typeOf = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n.type as NodeType])), [nodes]);
  const labelOf = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n.data.label])), [nodes]);

  if (!runId) return <p className="px-3 py-2 text-xs text-muted">Run the graph to see the timeline.</p>;
  if (!tl.spans.length) return <p className="px-3 py-2 text-xs text-muted">Waiting for the first node…</p>;

  const total = Math.max(tl.total, 1);
  const pct = (v: number) => `${(v / total) * 100}%`;
  const ticks = niceTicks(total);

  const pick = (s: Span) => {
    setPicked(s);
    if (s.node) select(s.node);
  };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-4 border-b border-edge px-3 py-1 text-[11px] text-muted">
          <span>
            total <b className="text-fg">{fmtMs(tl.total)}</b>
          </span>
          {tl.waiting > 0 && (
            <span>
              waiting on human <b className="text-pink-300">{fmtMs(tl.waiting)}</b>
            </span>
          )}
          <span>
            model calls <b className="text-fg">{tl.llmCalls}</b>
          </span>
          <span>
            cost <b className="text-fg">${tl.cost.toFixed(6)}</b>
          </span>
          <span className="ml-auto">{tl.spans.length} steps</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative">
            {/* axis */}
            <div className="sticky top-0 z-10 flex h-5 bg-panel text-[10px] text-muted/70">
              <div className="w-36 shrink-0" />
              <div className="relative flex-1">
                {ticks.map((t) => (
                  <span key={t} className="absolute -translate-x-1/2 border-l border-edge pl-1" style={{ left: pct(t) }}>
                    {fmtMs(t)}
                  </span>
                ))}
              </div>
            </div>
            {tl.spans.map((s) => {
              const color = s.kind === "wait" ? "#f472b6" : toneByType[typeOf[s.node ?? ""] ?? "llm"];
              const dur = s.end - s.start;
              const active = picked?.key === s.key;
              return (
                <div key={s.key} onClick={() => pick(s)} className={`flex h-7 cursor-pointer items-center text-[11px] hover:bg-panel-2 ${active ? "bg-panel-3" : ""}`}>
                  <div className="w-36 shrink-0 truncate px-3 text-muted">
                    {s.kind === "wait" ? <span className="text-pink-300">waiting · {labelOf[s.node ?? ""] ?? s.node}</span> : (labelOf[s.node ?? ""] ?? s.node)}
                  </div>
                  <div className="relative h-full flex-1">
                    {ticks.map((t) => (
                      <span key={t} className="absolute inset-y-0 border-l border-edge/40" style={{ left: pct(t) }} />
                    ))}
                    <div
                      className={`absolute top-1.5 h-4 rounded-sm ${s.open ? "animate-pulse" : ""}`}
                      style={{
                        left: pct(s.start),
                        width: `max(2px, ${pct(dur)})`,
                        background: s.kind === "wait" ? WAIT_STRIPES : color,
                        opacity: active ? 1 : 0.85,
                      }}
                      title={`${s.node ?? ""} · ${fmtMs(dur)}${s.usage?.cost_usd != null ? ` · $${s.usage.cost_usd}` : ""}`}
                    />
                    <span className="absolute top-1.5 ml-1.5 h-4 whitespace-nowrap text-[10px] leading-4 text-muted" style={{ left: `calc(${pct(s.end)} + 0px)` }}>
                      {fmtMs(dur)}
                      {s.usage?.output_tokens != null && <span className="text-muted/70"> · {String(s.usage.input_tokens)}→{String(s.usage.output_tokens)} tok</span>}
                      {s.usage?.cost_usd != null && <span className="text-muted/70"> · ${String(s.usage.cost_usd)}</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {picked && <StepDetail span={picked} label={labelOf[picked.node ?? ""] ?? picked.node ?? ""} onClose={() => setPicked(null)} />}
    </div>
  );
}

function StepDetail({ span, label, onClose }: { span: Span; label: string; onClose: () => void }) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-edge">
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px]">
        <span className="font-medium text-fg">{span.kind === "wait" ? `waiting · ${label}` : label}</span>
        <button onClick={onClose} className="text-muted hover:text-fg">
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-2 text-[11px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted">
          <dt>duration</dt>
          <dd className="text-fg">{fmtMs(span.end - span.start)}</dd>
          {span.usage?.model != null && (
            <>
              <dt>model</dt>
              <dd className="font-mono text-fg">{String(span.usage.model)}</dd>
              <dt>tokens</dt>
              <dd className="text-fg">
                {String(span.usage.input_tokens)} in · {String(span.usage.output_tokens)} out
              </dd>
              <dt>cost</dt>
              <dd className="text-fg">${String(span.usage.cost_usd)}</dd>
            </>
          )}
          <dt>event</dt>
          <dd className="text-fg">#{span.seq}</dd>
        </dl>
        {span.output && (
          <div>
            <div className="mb-0.5 text-muted">output</div>
            <pre className="whitespace-pre-wrap rounded-md border border-edge bg-panel-2 p-2 font-mono text-[10.5px] text-fg">{JSON.stringify(span.output, null, 2)}</pre>
          </div>
        )}
      </div>
    </aside>
  );
}

function niceTicks(total: number): number[] {
  const raw = total / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let t = 0; t <= total; t += step) out.push(t);
  return out;
}
