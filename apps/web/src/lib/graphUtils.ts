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

const VAR_RE = /\{\{\s*([a-zA-Z_][\w]*)(?:\.[\w.]+)?\s*\}\}/g;

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectStrings(x, out));
}

/** Variables referenced in templates that no node produces: these must come from run input. */
export function inputKeys(nodes: StudioNode[]): string[] {
  const produced = new Set(allKeys(nodes));
  const strings: string[] = [];
  for (const n of nodes) collectStrings(n.data.config, strings);
  const used = new Set<string>();
  for (const s of strings) for (const m of s.matchAll(VAR_RE)) used.add(m[1]);
  return [...used].filter((k) => !produced.has(k));
}
