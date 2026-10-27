"use client";

import { create } from "zustand";
import type { Checkpoint, InterruptPayload, RunEvent, RunStatus, RunUsage } from "@/lib/types";

export type NodeStatus = "idle" | "running" | "done" | "error" | "paused";

type State = {
  runId: string | null;
  status: RunStatus | null;
  connected: boolean;
  nodeStatus: Record<string, NodeStatus>;
  tokens: Record<string, string>;
  outputs: Record<string, Record<string, unknown>>;
  events: RunEvent[];
  interrupt: InterruptPayload | null;
  usage: Partial<RunUsage> | null;
  error: string | null;
  lastSeq: number;
  startedAt: number | null;
  checkpoints: Checkpoint[];
  checkpointsFor: string | null; // run id the list belongs to
  replayIndex: number | null; // index into checkpoints while scrubbing, null = live view
  replayStatus: Record<string, NodeStatus> | null; // derived from replayIndex
  heat: Record<string, number> | null; // node id -> share of failed eval rows
};

type Actions = {
  begin: (runId: string, status?: RunStatus) => void;
  apply: (ev: RunEvent) => void;
  setConnected: (v: boolean) => void;
  clear: () => void;
  setCheckpoints: (runId: string, cps: Checkpoint[]) => void;
  setReplayIndex: (i: number | null) => void;
  setHeat: (h: Record<string, number> | null) => void;
};

const empty: State = {
  runId: null,
  status: null,
  connected: false,
  nodeStatus: {},
  tokens: {},
  outputs: {},
  events: [],
  interrupt: null,
  usage: null,
  error: null,
  lastSeq: 0,
  startedAt: null,
  checkpoints: [],
  checkpointsFor: null,
  replayIndex: null,
  replayStatus: null,
  heat: null,
};

export const TERMINAL: RunStatus[] = ["done", "error", "cancelled"];

export const useRunStore = create<State & Actions>()((set) => ({
  ...empty,

  begin: (runId, status = "queued") => set({ ...empty, runId, status, startedAt: Date.now() }),
  setConnected: (connected) => set({ connected }),
  clear: () => set({ ...empty }),
  setHeat: (heat) => set({ heat }),
  setCheckpoints: (runId, cps) => set((s) => (s.runId === runId ? { checkpoints: cps, checkpointsFor: runId } : {})),
  setReplayIndex: (replayIndex) =>
    set((s) => ({ replayIndex, replayStatus: replayIndex === null ? null : replayStatuses(s.checkpoints, replayIndex) })),

  apply: (ev) =>
    set((s) => {
      const next: Partial<State> = {};
      if (ev.seq != null) {
        if (ev.seq <= s.lastSeq) return {}; // duplicate from replay
        next.lastSeq = ev.seq;
      }
      if (ev.type !== "token") next.events = [...s.events, ev];
      if (s.replayIndex !== null && ev.seq != null) {
        next.replayIndex = null;
        next.replayStatus = null;
      }
      const node = ev.node ?? undefined;

      switch (ev.type) {
        case "status":
          next.status = ev.status ?? s.status;
          break;
        case "run_start":
          next.status = "running";
          break;
        case "node_start":
          if (node) {
            next.nodeStatus = { ...s.nodeStatus, [node]: "running" };
            next.tokens = { ...s.tokens, [node]: "" };
          }
          break;
        case "token":
          if (node) next.tokens = { ...s.tokens, [node]: (s.tokens[node] ?? "") + (ev.text ?? "") };
          break;
        case "node_end":
          if (node) {
            next.nodeStatus = { ...s.nodeStatus, [node]: "done" };
            if (ev.output) next.outputs = { ...s.outputs, [node]: ev.output };
          }
          break;
        case "interrupt":
          next.status = "paused";
          next.interrupt = { node: node ?? "", question: ev.question ?? "", show: ev.show ?? {} };
          if (node) next.nodeStatus = { ...s.nodeStatus, [node]: "paused" };
          break;
        case "run_resume":
          next.status = "running";
          next.interrupt = null;
          if (s.interrupt?.node) next.nodeStatus = { ...s.nodeStatus, [s.interrupt.node]: "running" };
          break;
        case "run_end":
          next.status = "done";
          next.usage = (ev.usage as Partial<RunUsage>) ?? null;
          break;
        case "run_error":
          next.status = "error";
          next.error = ev.error ?? "unknown error";
          next.nodeStatus = Object.fromEntries(Object.entries(s.nodeStatus).map(([k, v]) => [k, v === "running" ? "error" : v]));
          break;
        case "run_cancelled":
          next.status = "cancelled";
          break;
        case "checkpoint":
          // passthrough nodes (start/end) emit no node_start/node_end; a checkpoint means they ran
          if (node && !s.nodeStatus[node]) next.nodeStatus = { ...s.nodeStatus, [node]: "done" };
          break;
      }
      return next;
    }),
}));

export const isTerminal = (s: RunStatus | null) => !!s && TERMINAL.includes(s);

/** Node statuses as they were right after checkpoint `index`: everything up to it is done,
 *  what runs next is highlighted. Used by the replay scrubber. */
export function replayStatuses(cps: Checkpoint[], index: number): Record<string, NodeStatus> {
  const out: Record<string, NodeStatus> = {};
  for (let i = 1; i <= index && i < cps.length; i++) if (cps[i].node) out[cps[i].node!] = "done";
  const cp = cps[index];
  if (cp) for (const n of cp.next) out[n] = cp.interrupted ? "paused" : "running";
  return out;
}
