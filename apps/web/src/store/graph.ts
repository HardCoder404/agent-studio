"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { temporal } from "zundo";
import { defaultConfig, nodeMeta, type GraphSpec, type Issue, type NodeType, type SpecEdge, type SpecNode } from "@/lib/types";

export type NodeData = { label: string; config: Record<string, unknown> };
export type StudioNode = Node<NodeData, NodeType>;
export type StudioEdge = Edge;

export type SaveState = "saved" | "dirty" | "saving" | "error";

type State = {
  graphId: string | null;
  name: string;
  version: number;
  nodes: StudioNode[];
  edges: StudioEdge[];
  issues: Issue[];
  selectedId: string | null;
  save: SaveState;
  saveError: string | null;
};

type Actions = {
  load: (spec: GraphSpec) => void;
  setName: (name: string) => void;
  onNodesChange: (changes: NodeChange<StudioNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<StudioEdge>[]) => void;
  onConnect: (c: Connection) => void;
  addNode: (type: NodeType, position: XYPosition) => string;
  updateNode: (id: string, patch: Partial<NodeData>) => void;
  updateConfig: (id: string, patch: Record<string, unknown>) => void;
  removeNode: (id: string) => void;
  renameBranch: (nodeId: string, from: string, to: string) => void;
  removeBranch: (nodeId: string, label: string) => void;
  select: (id: string | null) => void;
  markSaved: (spec: GraphSpec) => void;
  markSaving: () => void;
  markError: (message: string) => void;
  toSpec: () => { name: string; nodes: SpecNode[]; edges: SpecEdge[] };
};

export const toFlow = (spec: GraphSpec): { nodes: StudioNode[]; edges: StudioEdge[] } => ({
  nodes: spec.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { label: n.label || nodeMeta[n.type].title, config: n.config as Record<string, unknown> },
  })),
  edges: spec.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.label ?? undefined,
    label: e.label ?? undefined,
  })),
});

const toSpecEdge = (e: StudioEdge, nodes: StudioNode[]): SpecEdge => {
  const source = nodes.find((n) => n.id === e.source);
  const isRouter = source?.type === "router";
  return { id: e.id, source: e.source, target: e.target, label: isRouter ? (e.sourceHandle ?? null) : null };
};

export const useGraphStore = create<State & Actions>()(
  temporal(
    (set, get) => ({
      graphId: null,
      name: "",
      version: 0,
      nodes: [],
      edges: [],
      issues: [],
      selectedId: null,
      save: "saved",
      saveError: null,

      load: (spec) =>
        set({ graphId: spec.id, name: spec.name, version: spec.version, issues: spec.issues, ...toFlow(spec), save: "saved", saveError: null }),
      setName: (name) => set({ name, save: "dirty" }),

      onNodesChange: (changes) => {
        const structural = changes.some((c) => c.type !== "select" && c.type !== "dimensions");
        set((s) => ({
          nodes: applyNodeChanges(changes, s.nodes),
          ...(structural ? { save: "dirty" as const } : {}),
        }));
      },
      onEdgesChange: (changes) => {
        const structural = changes.some((c) => c.type !== "select");
        set((s) => ({
          edges: applyEdgeChanges(changes, s.edges),
          ...(structural ? { save: "dirty" as const } : {}),
        }));
      },
      onConnect: (c) => {
        const { nodes, edges } = get();
        const source = nodes.find((n) => n.id === c.source);
        // every non-router node has exactly one outgoing edge: replace, don't stack
        const kept = source?.type === "router" ? edges.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle)) : edges.filter((e) => e.source !== c.source);
        const edge: StudioEdge = { id: `e_${nanoid(6)}`, source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? undefined, label: source?.type === "router" ? (c.sourceHandle ?? undefined) : undefined };
        set({ edges: addEdge(edge, kept), save: "dirty" });
      },

      addNode: (type, position) => {
        const id = `${type}_${nanoid(5)}`;
        const node: StudioNode = {
          id,
          type,
          position,
          data: { label: nodeMeta[type].title, config: structuredClone(defaultConfig[type]) as Record<string, unknown> },
          selected: true,
        };
        set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), node], selectedId: id, save: "dirty" }));
        return id;
      },
      updateNode: (id, patch) =>
        set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), save: "dirty" })),
      updateConfig: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n)),
          save: "dirty",
        })),
      removeNode: (id) =>
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          edges: s.edges.filter((e) => e.source !== id && e.target !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
          save: "dirty",
        })),
      select: (id) => set({ selectedId: id }),

      renameBranch: (nodeId, from, to) =>
        set((s) => ({
          nodes: s.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const cfg = n.data.config as { branches: { label: string; when: string }[] };
            return { ...n, data: { ...n.data, config: { ...cfg, branches: cfg.branches.map((b) => (b.label === from ? { ...b, label: to } : b)) } } };
          }),
          edges: s.edges.map((e) => (e.source === nodeId && e.sourceHandle === from ? { ...e, sourceHandle: to, label: to } : e)),
          save: "dirty",
        })),
      removeBranch: (nodeId, label) =>
        set((s) => ({
          nodes: s.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const cfg = n.data.config as { branches: { label: string; when: string }[] };
            return { ...n, data: { ...n.data, config: { ...cfg, branches: cfg.branches.filter((b) => b.label !== label) } } };
          }),
          edges: s.edges.filter((e) => !(e.source === nodeId && e.sourceHandle === label)),
          save: "dirty",
        })),

      markSaving: () => set({ save: "saving" }),
      markSaved: (spec) => set((s) => (s.save === "saving" ? { save: "saved", version: spec.version, issues: spec.issues, saveError: null } : { version: spec.version, issues: spec.issues })),
      markError: (message) => set({ save: "error", saveError: message }),

      toSpec: () => {
        const { name, nodes, edges } = get();
        return {
          name,
          nodes: nodes.map((n) => ({ id: n.id, type: n.type as NodeType, label: n.data.label, position: n.position, config: n.data.config }) as SpecNode),
          edges: edges.map((e) => toSpecEdge(e, nodes)),
        };
      },
    }),
    {
      // undo/redo tracks only what the user edits, not selection or save status
      partialize: (s) => ({ nodes: s.nodes, edges: s.edges, name: s.name }),
      limit: 100,
      equality: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
  ),
);

export const useTemporal = () => useGraphStore.temporal;
