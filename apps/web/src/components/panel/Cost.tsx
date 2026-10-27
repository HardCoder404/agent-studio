"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtMs } from "@/lib/timeline";
import type { GraphStats, StatBucket } from "@/lib/types";
import { useGraphStore } from "@/store/graph";
import { useRunStore } from "@/store/run";

const USD_INR = 84; // rough, for a second opinion on cost; the API reports USD

/** Cost and latency per node and per model over the graph's recent runs. */
export function Cost() {
  const graphId = useGraphStore((s) => s.graphId);
  const nodes = useGraphStore((s) => s.nodes);
  const status = useRunStore((s) => s.status);
  const [stats, setStats] = useState<GraphStats | null>(null);

  useEffect(() => {
    if (!graphId) return;
    api.getStats(graphId).then(setStats).catch(() => {});
  }, [graphId, status]);

  if (!stats) return <p className="px-3 py-2 text-xs text-muted">Loading…</p>;
  if (!stats.runs) return <p className="px-3 py-2 text-xs text-muted">No runs yet. Costs are estimated from list prices; free tiers bill nothing.</p>;
  const label = Object.fromEntries(nodes.map((n) => [n.id, n.data.label]));

  const t = stats.total;
  const perRun = t.cost_usd / stats.runs;
  return (
    <div className="flex h-full flex-col text-[11px]">
      <div className="flex flex-wrap items-center gap-4 border-b border-edge px-3 py-1.5 text-muted">
        <span>last <b className="text-fg">{stats.runs}</b> runs</span>
        <span>model calls <b className="text-fg">{t.calls}</b></span>
        <span>total <b className="text-fg">${t.cost_usd.toFixed(6)}</b> <span className="text-muted/70">≈ ₹{(t.cost_usd * USD_INR).toFixed(4)}</span></span>
        <span>per run <b className="text-fg">${perRun.toFixed(6)}</b></span>
        <span>at 10k runs/month <b className="text-fg">${(perRun * 10_000).toFixed(2)}</b> <span className="text-muted/70">≈ ₹{(perRun * 10_000 * USD_INR).toFixed(0)}</span></span>
        <span>p95 latency <b className="text-fg">{t.p95_ms != null ? fmtMs(t.p95_ms) : "–"}</b></span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-6 overflow-y-auto px-3 py-2">
        <StatTable title="by node" rows={Object.entries(stats.nodes)} label={label} />
        <StatTable title="by model" rows={Object.entries(stats.models)} label={label} />
      </div>
    </div>
  );
}

function StatTable({ title, rows, label }: { title: string; rows: [string, StatBucket][]; label: Record<string, string> }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-muted">{title}</div>
      <table className="w-full text-[11px]">
        <thead className="text-muted">
          <tr>
            <th className="py-0.5 text-left font-normal">name</th>
            <th className="py-0.5 text-right font-normal">calls</th>
            <th className="py-0.5 text-right font-normal">tokens in→out</th>
            <th className="py-0.5 text-right font-normal">avg</th>
            <th className="py-0.5 text-right font-normal">p95</th>
            <th className="py-0.5 text-right font-normal">cost</th>
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
            .map(([name, b]) => (
              <tr key={name} className="border-t border-edge/60">
                <td className="max-w-[12rem] truncate py-0.5 text-fg" title={name}>{label[name] ?? name.replace(/^groq\//, "")}</td>
                <td className="py-0.5 text-right text-muted">{b.calls}</td>
                <td className="py-0.5 text-right text-muted">{b.input_tokens}→{b.output_tokens}</td>
                <td className="py-0.5 text-right text-muted">{b.avg_ms != null ? fmtMs(b.avg_ms) : "–"}</td>
                <td className="py-0.5 text-right text-muted">{b.p95_ms != null ? fmtMs(b.p95_ms) : "–"}</td>
                <td className="py-0.5 text-right text-fg">${b.cost_usd.toFixed(6)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
