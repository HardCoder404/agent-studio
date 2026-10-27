"use client";

import { useEffect, useRef } from "react";
import { api, ApiError } from "@/lib/api";
import { useGraphStore } from "./graph";

const DELAY_MS = 700;

/** PUTs the graph to the API shortly after the last edit. */
export function useAutosave() {
  const save = useGraphStore((s) => s.save);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (save !== "dirty") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { graphId, toSpec, markSaving, markSaved, markError } = useGraphStore.getState();
      if (!graphId) return;
      markSaving();
      try {
        const spec = await api.updateGraph(graphId, toSpec());
        markSaved(spec);
      } catch (e) {
        markError(e instanceof ApiError ? e.message : String(e));
      }
    }, DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [save]);
}
