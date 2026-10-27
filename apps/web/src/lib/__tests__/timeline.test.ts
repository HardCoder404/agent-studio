import { describe, expect, it } from "vitest";
import { buildTimeline, fmtMs } from "../timeline";
import type { RunEvent } from "../types";

const t = (s: number) => new Date(1_700_000_000_000 + s * 1000).toISOString();

const events: RunEvent[] = [
  { seq: 1, type: "run_start", ts: t(0) },
  { seq: 2, type: "node_start", node: "write", ts: t(0.1) },
  { seq: 3, type: "node_end", node: "write", ts: t(0.6), usage: { model: "m", cost_usd: 0.002, latency_ms: 500 }, output: { draft: "x" } },
  { seq: 4, type: "node_start", node: "review", ts: t(0.6) },
  { seq: 5, type: "interrupt", node: "review", ts: t(0.6) },
  { seq: 6, type: "run_resume", ts: t(5.6) },
  { seq: 7, type: "node_end", node: "review", ts: t(5.7) },
  { seq: 8, type: "run_end", ts: t(5.8) },
];

describe("buildTimeline", () => {
  it("builds node and wait spans relative to run start", () => {
    const tl = buildTimeline(events);
    expect(tl.spans.map((s) => [s.kind, s.node, s.start, s.end])).toEqual([
      ["node", "write", 100, 600],
      ["node", "review", 600, 600],
      ["wait", "review", 600, 5600],
    ]);
    expect(tl.total).toBe(5800);
    expect(tl.waiting).toBe(5000);
    expect(tl.cost).toBeCloseTo(0.002);
    expect(tl.llmCalls).toBe(1);
    expect(tl.spans[0].output).toEqual({ draft: "x" });
  });

  it("extends open spans to now while a run is live", () => {
    const live = events.slice(0, 2);
    const tl = buildTimeline(live, Date.parse(t(3)));
    expect(tl.spans[0].open).toBe(true);
    expect(tl.spans[0].end).toBe(3000);
  });

  it("ignores events without timestamps", () => {
    const tl = buildTimeline([{ seq: null, type: "token", node: "write", text: "hi" }, ...events]);
    expect(tl.spans).toHaveLength(3);
  });
});

describe("fmtMs", () => {
  it("formats", () => {
    expect(fmtMs(412)).toBe("412 ms");
    expect(fmtMs(1234)).toBe("1.23 s");
    expect(fmtMs(12345)).toBe("12.3 s");
    expect(fmtMs(65000)).toBe("1m 5s");
  });
});
