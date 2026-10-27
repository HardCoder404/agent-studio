"use client";

import { useEffect } from "react";
import { WS_URL } from "@/lib/api";
import type { RunEvent } from "@/lib/types";
import { isTerminal, useRunStore } from "./run";

/** Keeps a WebSocket open for the current run, replaying from the last seen seq on reconnect. */
export function useRunSocket() {
  const runId = useRunStore((s) => s.runId);

  useEffect(() => {
    if (!runId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const { lastSeq } = useRunStore.getState();
      ws = new WebSocket(`${WS_URL}/ws/runs/${runId}?after=${lastSeq}`);
      ws.onopen = () => useRunStore.getState().setConnected(true);
      ws.onmessage = (m) => useRunStore.getState().apply(JSON.parse(m.data) as RunEvent);
      ws.onclose = () => {
        useRunStore.getState().setConnected(false);
        if (closed || isTerminal(useRunStore.getState().status)) return;
        retry = setTimeout(connect, 1000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [runId]);
}
