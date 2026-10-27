import type { RunEvent } from "./types";

export type Span = {
  key: string;
  node: string | null;
  kind: "node" | "wait";
  start: number; // ms since run start
  end: number; // ms since run start
  open: boolean; // still running when computed
  seq: number | null;
  usage?: Record<string, number | string>;
  output?: Record<string, unknown>;
};

export type Timeline = { spans: Span[]; total: number; t0: number | null; waiting: number; cost: number; llmCalls: number };

const ms = (iso?: string) => (iso ? Date.parse(iso) : NaN);

/** Waterfall spans from persisted run events. Token/status events carry no timestamps and are ignored. */
export function buildTimeline(events: RunEvent[], now: number = Date.now()): Timeline {
  const spans: Span[] = [];
  const openNodes = new Map<string, Span>();
  let wait: Span | null = null;
  let t0: number | null = null;
  let last = 0;
  let cost = 0;
  let llmCalls = 0;

  const rel = (t: number) => Math.max(0, t - (t0 ?? t));

  for (const e of events) {
    const t = ms(e.ts);
    if (Number.isNaN(t)) continue;
    if (t0 === null) t0 = t;
    const r = rel(t);
    last = Math.max(last, r);

    switch (e.type) {
      case "node_start": {
        if (!e.node) break;
        const span: Span = { key: `${e.node}:${e.seq}`, node: e.node, kind: "node", start: r, end: r, open: true, seq: e.seq };
        openNodes.set(e.node, span);
        spans.push(span);
        break;
      }
      case "node_end": {
        if (!e.node) break;
        const span = openNodes.get(e.node);
        if (span) {
          span.end = r;
          span.open = false;
          span.usage = e.usage;
          span.output = e.output;
          openNodes.delete(e.node);
          if (e.usage && "model" in e.usage) {
            llmCalls += 1;
            cost += Number(e.usage.cost_usd ?? 0);
          }
        }
        break;
      }
      case "interrupt": {
        wait = { key: `wait:${e.seq}`, node: e.node ?? null, kind: "wait", start: r, end: r, open: true, seq: e.seq };
        spans.push(wait);
        // the human node itself is not "running" while we wait
        if (e.node) {
          const span = openNodes.get(e.node);
          if (span) {
            span.end = r;
            span.open = false;
            openNodes.delete(e.node);
          }
        }
        break;
      }
      case "run_resume": {
        if (wait) {
          wait.end = r;
          wait.open = false;
          wait = null;
        }
        break;
      }
      case "run_end":
      case "run_error":
      case "run_cancelled": {
        for (const span of openNodes.values()) {
          span.end = r;
          span.open = false;
        }
        openNodes.clear();
        if (wait) {
          wait.end = r;
          wait.open = false;
          wait = null;
        }
        break;
      }
    }
  }

  // anything still open extends to "now"
  const nowRel = t0 === null ? 0 : Math.max(last, now - t0);
  for (const span of spans) if (span.open) span.end = nowRel;
  const total = spans.length ? Math.max(last, ...spans.map((s) => s.end)) : 0;
  const waiting = spans.filter((s) => s.kind === "wait").reduce((a, s) => a + (s.end - s.start), 0);
  return { spans, total, t0, waiting, cost, llmCalls };
}

export function fmtMs(v: number): string {
  if (v < 1000) return `${Math.round(v)} ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(v < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(v / 60_000)}m ${Math.round((v % 60_000) / 1000)}s`;
}
