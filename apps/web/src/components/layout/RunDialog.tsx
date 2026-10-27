"use client";

import { Play, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { inputKeys } from "@/lib/graphUtils";
import { useGraphStore } from "@/store/graph";
import { useRunStore } from "@/store/run";

type Props = { onClose: () => void };

function loadSaved(graphId: string): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(`run-input:${graphId}`) ?? "{}");
  } catch {
    return {};
  }
}

/** Asks for the run input: one field per template variable no node produces. Mounted fresh on each open. */
export function RunDialog({ onClose }: Props) {
  const graphId = useGraphStore((s) => s.graphId);
  const nodes = useGraphStore((s) => s.nodes);
  const keys = useMemo(() => inputKeys(nodes), [nodes]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const saved = graphId ? loadSaved(graphId) : {};
    return Object.fromEntries(keys.map((k) => [k, typeof saved[k] === "string" ? (saved[k] as string) : ""]));
  });
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState(() => JSON.stringify(graphId ? loadSaved(graphId) : {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!graphId) return null;

  const submit = async () => {
    let input: Record<string, unknown>;
    try {
      input = raw ? JSON.parse(rawText) : values;
    } catch {
      setError("input is not valid JSON");
      return;
    }
    setBusy(true);
    try {
      const run = await api.createRun(graphId, input);
      localStorage.setItem(`run-input:${graphId}`, JSON.stringify(input));
      useRunStore.getState().begin(run.id, run.status);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div className="w-[28rem] rounded-xl border border-edge bg-panel p-4 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Run input</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-fg">
            <X size={14} />
          </button>
        </div>

        {keys.length === 0 && !raw && <p className="mb-3 text-xs text-muted">No input variables are referenced. Run with an empty input, or switch to JSON.</p>}

        {!raw ? (
          <div className="space-y-2">
            {keys.map((k) => (
              <label key={k} className="block">
                <span className="mb-1 block font-mono text-xs text-sky-300">{`{{${k}}}`}</span>
                <input
                  autoFocus={k === keys[0]}
                  value={values[k] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="w-full rounded-md border border-edge bg-canvas px-2.5 py-1.5 text-sm text-fg outline-none focus:border-sky-500/60"
                />
              </label>
            ))}
          </div>
        ) : (
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={6} className="w-full rounded-md border border-edge bg-canvas p-2 font-mono text-xs text-fg outline-none focus:border-sky-500/60" />
        )}

        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

        <div className="mt-4 flex items-center justify-between">
          <button onClick={() => setRaw((r) => !r)} className="text-xs text-muted hover:text-fg">
            {raw ? "Form" : "JSON"}
          </button>
          <button onClick={submit} disabled={busy} className="flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50">
            <Play size={14} /> {busy ? "Starting…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
