"use client";

import { Check, Copy, Play, Send, Webhook } from "lucide-react";
import QRCode from "qrcode";
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
  const [waiting, setWaiting] = useState(false);

  const reload = () => graphId && api.getTriggers(graphId).then(setInfo).catch((e) => setError(String(e)));
  // after "Connect Telegram" the bind happens on the phone; poll until the API says linked (max 2 min)
  useEffect(() => {
    if (!waiting || !graphId) return;
    let ticks = 0;
    const id = setInterval(async () => {
      ticks += 1;
      try {
        const t = await api.getTriggers(graphId);
        setInfo(t);
        if (t.telegram.linked || ticks > 40) setWaiting(false);
      } catch {}
    }, 3000);
    return () => clearInterval(id);
  }, [waiting, graphId]);
  const startWaiting = () => setWaiting(true);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    const url = info?.telegram.connect_url;
    if (!url || info?.telegram.linked) return;
    let alive = true;
    QRCode.toDataURL(url, { margin: 0, width: 168, color: { dark: "#111113", light: "#ffffff" } })
      .then((d) => alive && setQr(d))
      .catch(() => {});
    return () => { alive = false; };
  }, [info?.telegram.connect_url, info?.telegram.linked]);
  const unlink = async () => {
    if (!graphId) return;
    await api.unlinkTelegram(graphId).catch(() => {});
    setWaiting(false);
    reload();
  };

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
          <div className={`rounded-md border px-2 py-1.5 ${info.telegram.linked ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-edge bg-panel-2 text-muted"}`}>
            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${info.telegram.linked ? "bg-emerald-400" : info.telegram.bot ? "bg-amber-400" : "bg-zinc-500"}`} />
            {info.telegram.linked ? "connected to your Telegram" : info.telegram.bot ? (waiting ? "waiting for you to press Start…" : "not connected") : "no bot on this server"}
            <div className="mt-1 text-[10.5px] opacity-80">{info.telegram.hint}</div>
            <div className="mt-2 flex items-center gap-2">
              {info.telegram.linked ? (
                <button onClick={unlink} className="btn btn-sm btn-quiet">Disconnect</button>
              ) : info.telegram.connect_url ? (
                <a href={info.telegram.connect_url} target="_blank" rel="noreferrer" onClick={startWaiting} className="btn btn-sm btn-primary">
                  <Send size={11} strokeWidth={2.5} /> Connect Telegram
                </a>
              ) : null}
              {waiting && !info.telegram.linked && <span className="text-muted">press <span className="font-mono text-fg">Start</span> in the bot, this updates by itself</span>}
            </div>
            {!info.telegram.linked && info.telegram.connect_url && (
              <div className="mt-2 flex items-start gap-3 border-t border-edge pt-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise */}
                {qr && <img src={qr} alt="QR code that opens the bot" width={84} height={84} className="shrink-0 rounded-md bg-white p-1" />}
                <div className="min-w-0 text-muted">
                  <div>No Telegram app on this computer? Scan the code with your phone, or open <span className="font-mono text-fg">@{info.telegram.connect_url.replace("https://t.me/", "").split("?")[0]}</span> in Telegram and send:</div>
                  {info.telegram.start_command && (
                    <div className="mt-1 flex items-center gap-1 rounded-md border border-edge bg-canvas px-2 py-1">
                      <code className="min-w-0 flex-1 truncate font-mono text-fg" title={info.telegram.start_command}>{info.telegram.start_command}</code>
                      <CopyButton text={info.telegram.start_command} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-muted">
          {hasHuman
            ? "This graph has a Human step. When a run pauses there, the question and the draft arrive as a Telegram message with answer buttons. Pressing one resumes the run; the Studio tab updates live."
            : "This graph has no Human step yet, so there is nothing to approve. Add one from the palette to pause runs for a decision."}
        </p>
        <p className="mt-2 text-muted">Each graph connects its own chat, so approvals only ever reach the person who connected it. Tools <span className="font-mono text-fg">telegram_send</span> and <span className="font-mono text-fg">http_post</span> let a graph push its result out, so the whole loop can run without the browser.</p>
      </div>
    </div>
  );
}
