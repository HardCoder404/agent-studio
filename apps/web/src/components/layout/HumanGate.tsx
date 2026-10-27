"use client";

import { UserRound } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { InterruptPayload } from "@/lib/types";
import { useGraphStore } from "@/store/graph";
import { useRunStore } from "@/store/run";

/** Shown while a run is paused at a human node. Resumes the run with the answer. */
export function HumanGate() {
  const runId = useRunStore((s) => s.runId);
  const status = useRunStore((s) => s.status);
  const interrupt = useRunStore((s) => s.interrupt);
  const lastSeq = useRunStore((s) => s.lastSeq);
  if (!runId || status !== "paused" || !interrupt) return null;
  // keyed by the interrupt so the answer box resets for every new pause
  return <Gate key={`${runId}:${lastSeq}`} runId={runId} interrupt={interrupt} />;
}

function Gate({ runId, interrupt }: { runId: string; interrupt: InterruptPayload }) {
  const label = useGraphStore((s) => s.nodes.find((n) => n.id === interrupt.node)?.data.label);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  const quick = /yes\/no|\(yes|approve/i.test(interrupt.question) ? ["yes", "no"] : [];

  const send = async (value: string) => {
    setBusy(true);
    try {
      await api.resumeRun(runId, value);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
      <div className="pointer-events-auto w-[30rem] rounded-xl border border-pink-500/40 bg-panel p-4 shadow-2xl shadow-black/50">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-pink-300">
          <UserRound size={13} /> {label ?? interrupt.node} is waiting for you
        </div>
        <p className="text-sm text-fg">{interrupt.question}</p>
        {Object.keys(interrupt.show).length > 0 && (
          <dl className="mt-2 max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-edge bg-canvas p-2">
            {Object.entries(interrupt.show).map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[10px] text-sky-300">{k}</dt>
                <dd className="whitespace-pre-wrap text-xs text-fg">{typeof v === "string" ? v : JSON.stringify(v, null, 2)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-3 flex items-center gap-2">
          {quick.map((q) => (
            <button key={q} onClick={() => send(q)} disabled={busy} className="rounded-md border border-edge px-3 py-1.5 text-sm text-fg hover:bg-white/5 disabled:opacity-50">
              {q}
            </button>
          ))}
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && answer.trim() && send(answer.trim())}
            placeholder={quick.length ? "or type an answer…" : "Type an answer…"}
            className="min-w-0 flex-1 rounded-md border border-edge bg-canvas px-2.5 py-1.5 text-sm text-fg outline-none focus:border-pink-500/60"
          />
          <button onClick={() => answer.trim() && send(answer.trim())} disabled={busy || !answer.trim()} className="rounded-md bg-pink-500/20 px-3 py-1.5 text-sm text-pink-200 hover:bg-pink-500/30 disabled:opacity-50">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
