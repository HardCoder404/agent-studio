import type { StudioEdge, StudioNode } from "@/store/graph";

/** Variable names a node can reference: output keys of everything upstream of it. */
export function upstreamKeys(nodeId: string, nodes: StudioNode[], edges: StudioEdge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const keys: string[] = [];
  const stack = edges.filter((e) => e.target === nodeId).map((e) => e.source);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    const c = n.data.config as { output_key?: string };
    if ((n.type === "llm" || n.type === "tool" || n.type === "human") && c.output_key && !keys.includes(c.output_key)) {
      keys.push(c.output_key);
    }
    stack.push(...edges.filter((e) => e.target === id).map((e) => e.source));
  }
  return keys;
}

/** All output keys in the graph, for pickers that are not position-aware. */
export function allKeys(nodes: StudioNode[]): string[] {
  const out = new Set<string>();
  for (const n of nodes) {
    const c = n.data.config as { output_key?: string };
    if (c.output_key) out.add(c.output_key);
  }
  return [...out];
}
