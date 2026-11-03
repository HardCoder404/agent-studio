"use client";

import { Check, Copy, Play, Send, Webhook } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { inputKeys } from "@/lib/graphUtils";
import type { TriggersInfo } from "@/lib/types";
import { useGraphStore } from "@/store/graph";
import { useRunStore } from "@/store/run";

function sampleInput(keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, `example ${k}`]));
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}
      className="icon-btn"
      title="Copy"
    >
      {done ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
    </button>
  );
}

/** Start this graph from outside (signed webhook) and answer its human gates from Telegram. */
export function Triggers() {
  const graphId = useGraphStore((s) => s.graphId);
  const nodes = useGraphStore((s) => s.nodes);
  const issues = useGraphStore((s) => s.issues);
  const keys = useMemo(() => inputKeys(nodes), [nodes]);
  const [info, setInfo] = useState<TriggersInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  useEffect(() => {
    if (!graphId) return;
    let alive = true;
    api.getTriggers(graphId).then((t) => alive && setInfo(t)).catch((e) => alive && setError(String(e)));
    return () => { alive = false; };
  }, [graphId]);

  const body = JSON.stringify(sampleInput(keys), null, 2);
  const curl = info?.webhook.url ? `curl -X POST '${info.webhook.url}' \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(sampleInput(keys))}'` : "";

  const fire = async () => {
    if (!info?.webhook.url) return;
    setTesting(true); setTested(null);
    try {
      const res = await fetch(info.webhook.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sampleInput(keys)) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`);
      useRunStore.getState().begin(data.id, data.status);
      setTested(`run ${String(data.id).slice(0, 8)} started from the webhook`);
    } catch (e) {
      setTested(`failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const hasHuman = nodes.some((n) => n.type === "human");

  return (
    <div className="grid h-full grid-cols-[1fr_22rem] overflow-hidden text-[11px]">
      <div className="overflow-y-auto border-r border-edge px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1 text-muted">
          <Webhook size={11} /> webhook · start this graph from anywhere
        </div>
        {error && <p className="text-rose-300">{error}</p>}
        {info && !info.webhook.enabled && (
          <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-amber-100">
            Webhooks are off on this API. Set <span className="font-mono">WEBHOOK_SECRET</span> to any long random string and restart.
          </p>
        )}
        {info?.webhook.url && (
          <>
            <div className="flex items-center gap-1 rounded-md border border-edge bg-panel-2 px-2 py-1">
              <span className="pill border border-edge-2 bg-panel-3 text-muted">POST</span>
              <code className="min-w-0 flex-1 truncate font-mono text-fg" title={info.webhook.url}>{info.webhook.url}</code>
              <CopyButton text={info.webhook.url} />
            </div>
            <p className="mt-1.5 text-muted">
              Send a JSON object. Its keys become the run input{keys.length ? <> (this graph reads <span className="font-mono text-fg">{keys.join(", ")}</span>)</> : null}. The URL is signed, treat it like a password.
            </p>
            <div className="mt-2 flex items-center justify-between text-muted">
              <span>example</span>
              <CopyButton text={curl} />
            </div>
            <pre className="mt-1 overflow-x-auto rounded-md border border-edge bg-canvas px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-fg">{curl}</pre>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={fire} disabled={testing || issues.length > 0} className="btn btn-sm btn-primary" title={issues.length ? "fix the graph's issues first" : "POST the example body to the webhook"}>
                <Play size={11} strokeWidth={2.5} /> {testing ? "Sending…" : "Send test request"}
              </button>
              {tested && <span className={tested.startsWith("failed") ? "text-rose-300" : "text-emerald-300"}>{tested}</span>}
            </div>
            <details className="mt-3 text-muted">
              <summary className="cursor-pointer hover:text-fg">Example body</summary>
              <pre className="mt-1 rounded-md border border-edge bg-canvas px-2 py-1.5 font-mono text-[10.5px] text-fg">{body}</pre>
            </details>
          </>
        )}
      </div>
      <div className="overflow-y-auto px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1 text-muted">
          <Send size={11} /> telegram · answer human gates from your phone
        </div>
        {info && (
          <div className={`rounded-md border px-2 py-1.5 ${info.telegram.enabled ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-edge bg-panel-2 text-muted"}`}>
            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${info.telegram.enabled ? "bg-emerald-400" : "bg-zinc-500"}`} />
            {info.telegram.enabled ? "connected" : "not connected"}
            <div className="mt-1 text-[10.5px] opacity-80">{info.telegram.hint}</div>
          </div>
        )}
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted">
          <li>Create a bot with @BotFather and copy its token.</li>
          <li>Set <span className="font-mono text-fg">TELEGRAM_BOT_TOKEN</span>, <span className="font-mono text-fg">WEBHOOK_SECRET</span> and <span className="font-mono text-fg">PUBLIC_API_URL</span> on the API.</li>
          <li>Send <span className="font-mono text-fg">/start</span> to the bot, it replies with your chat id. Set <span className="font-mono text-fg">TELEGRAM_CHAT_ID</span>.</li>
        </ol>
        <p className="mt-2 text-muted">
          {hasHuman
            ? "This graph has a Human step. When a run pauses there, the question and the draft arrive as a Telegram message with answer buttons. Pressing one resumes the run; the Studio tab updates live."
            : "This graph has no Human step yet, so there is nothing to approve. Add one from the palette to pause runs for a decision."}
        </p>
        <p className="mt-2 text-muted">Tools <span className="font-mono text-fg">telegram_send</span> and <span className="font-mono text-fg">http_post</span> let a graph push its result out, so the whole loop can run without the browser.</p>
      </div>
    </div>
  );
}
