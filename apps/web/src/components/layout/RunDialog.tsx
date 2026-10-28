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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card w-[28rem] p-5 shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Run input</h2>
            <p className="text-xs text-muted">Values for the variables no node produces.</p>
          </div>
          <button onClick={onClose} className="icon-btn">
            <X size={14} />
          </button>
        </div>

        {keys.length === 0 && !raw && <p className="mb-3 text-xs text-muted">No input variables are referenced. Run with an empty input, or switch to JSON.</p>}

        {!raw ? (
          <div className="space-y-2">
            {keys.map((k) => (
              <label key={k} className="block">
                <span className="mb-1.5 block font-mono text-xs text-accent">{`{{${k}}}`}</span>
                <input
                  autoFocus={k === keys[0]}
                  value={values[k] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="input"
                />
              </label>
            ))}
          </div>
        ) : (
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={6} className="input font-mono text-xs" />
        )}

        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

        <div className="mt-5 flex items-center justify-between">
          <button onClick={() => setRaw((r) => !r)} className="btn btn-sm btn-quiet">
            {raw ? "Form" : "JSON"}
          </button>
          <button onClick={submit} disabled={busy} className="btn btn-primary">
            <Play size={14} strokeWidth={2.5} /> {busy ? "Starting…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
