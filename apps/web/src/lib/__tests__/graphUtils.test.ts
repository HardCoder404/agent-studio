import { describe, expect, it } from "vitest";
import type { StudioEdge, StudioNode } from "@/store/graph";
import { allKeys, inputKeys, upstreamKeys } from "../graphUtils";

const n = (id: string, type: StudioNode["type"], config: Record<string, unknown>): StudioNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, config } }) as StudioNode;

const nodes: StudioNode[] = [
  n("start", "start", {}),
  n("write", "llm", { prompt: "Write about {{topic}} in {{tone}} tone", output_key: "draft" }),
  n("review", "human", { question: "ok? {{draft}}", output_key: "decision", show_keys: [] }),
  n("route", "router", { mode: "rule", branches: [{ label: "yes", when: "decision == 'yes'" }] }),
  n("end", "end", {}),
];
const edges: StudioEdge[] = [
  { id: "1", source: "start", target: "write" },
  { id: "2", source: "write", target: "review" },
  { id: "3", source: "review", target: "route" },
  { id: "4", source: "route", target: "end", sourceHandle: "yes" },
];

describe("graphUtils", () => {
  it("upstreamKeys walks edges backwards", () => {
    expect(upstreamKeys("route", nodes, edges)).toEqual(["decision", "draft"]);
    expect(upstreamKeys("write", nodes, edges)).toEqual([]);
  });
  it("allKeys lists every output key", () => {
    expect(allKeys(nodes).sort()).toEqual(["decision", "draft"]);
  });
  it("inputKeys = referenced vars nobody produces", () => {
    expect(inputKeys(nodes).sort()).toEqual(["tone", "topic"]);
  });
});
