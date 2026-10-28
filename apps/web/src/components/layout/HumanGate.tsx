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
      <div className="card pointer-events-auto w-[32rem] border-pink-400/40 p-4 shadow-2xl shadow-black/60 ring-1 ring-pink-400/15">
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-pink-400/12 text-pink-300"><UserRound size={14} /></span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-tight">{label ?? interrupt.node} is waiting for you</div>
            <div className="text-[10.5px] text-dim">run paused at a human gate</div>
          </div>
        </div>
        <p className="text-sm text-fg">{interrupt.question}</p>
        {Object.keys(interrupt.show).length > 0 && (
          <dl className="card-2 mt-2.5 max-h-40 space-y-1.5 overflow-y-auto p-2.5">
            {Object.entries(interrupt.show).map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[10px] text-accent">{k}</dt>
                <dd className="whitespace-pre-wrap text-xs text-fg">{typeof v === "string" ? v : JSON.stringify(v, null, 2)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-3 flex items-center gap-2">
          {quick.map((q) => (
            <button key={q} onClick={() => send(q)} disabled={busy} className="btn btn-sm btn-ghost capitalize">
              {q}
            </button>
          ))}
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && answer.trim() && send(answer.trim())}
            placeholder={quick.length ? "or type an answer…" : "Type an answer…"}
            className="input min-w-0 flex-1 py-1"
          />
          <button onClick={() => answer.trim() && send(answer.trim())} disabled={busy || !answer.trim()} className="btn btn-sm border border-pink-400/30 bg-pink-400/15 text-pink-100 hover:bg-pink-400/25">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
