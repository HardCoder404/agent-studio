"use client";

import { Plug, Plus, RefreshCw, Trash2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { MCPServerInfo } from "@/lib/types";
import { refreshTools, useTools } from "@/lib/useCatalog";

const statusColor: Record<string, string> = { connected: "text-emerald-300", connecting: "text-sky-300", stopped: "text-rose-300", disconnected: "text-muted" };

/** Built-in tools and MCP servers: connect a server and its tools appear in Tool nodes. */
export function Tools() {
  const tools = useTools();
  const [servers, setServers] = useState<MCPServerInfo[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.listMcp().then(setServers).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const refresh = async (id: string) => {
    setBusy(id);
    try {
      await api.refreshMcp(id);
      await Promise.all([load(), refreshTools()]);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (id: string) => {
    setBusy(id);
    try {
      await api.deleteMcp(id);
      await Promise.all([load(), refreshTools()]);
    } finally {
      setBusy(null);
    }
  };

  const builtin = tools.filter((t) => !t.server);
  return (
    <div className="grid h-full grid-cols-[22rem_1fr] overflow-hidden text-[11px]">
      <div className="overflow-y-auto border-r border-edge px-3 py-2">
        <div className="mb-1 flex items-center gap-1 text-muted">
          <Wrench size={11} /> built-in tools
        </div>
        <ul className="mb-3 space-y-1">
          {builtin.map((t) => (
            <li key={t.name} className="rounded-md border border-edge bg-panel-2 px-2 py-1">
              <span className="font-mono text-fg">{t.name}</span>
              <span className="ml-2 text-muted">{t.description}</span>
            </li>
          ))}
        </ul>
        <div className="mb-1 flex items-center justify-between text-muted">
          <span className="flex items-center gap-1">
            <Plug size={11} /> MCP servers
          </span>
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-panel-3">
            <Plus size={11} /> connect
          </button>
        </div>
        <ul className="space-y-1.5">
          {!servers.length && <li className="text-muted">No servers yet. Connect one to pull its tools into the palette.</li>}
          {servers.map((s) => (
            <li key={s.id} className="rounded-md border border-edge bg-panel-2 p-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-fg">{s.name}</span>
                <span className={statusColor[s.status] ?? "text-muted"}>{s.status}</span>
                <span className="text-muted">· {s.tools.length} tools</span>
                <button onClick={() => refresh(s.id)} disabled={busy === s.id} className="ml-auto rounded p-1 text-muted hover:text-fg disabled:opacity-40" title="Reconnect and refresh tools">
                  <RefreshCw size={11} className={busy === s.id ? "animate-spin" : ""} />
                </button>
                <button onClick={() => remove(s.id)} disabled={busy === s.id} className="rounded p-1 text-muted hover:text-rose-400 disabled:opacity-40" title="Remove server">
                  <Trash2 size={11} />
                </button>
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-muted" title={s.transport === "stdio" ? `${s.command} ${s.args.join(" ")}` : (s.url ?? "")}>
                {s.transport === "stdio" ? `${s.command} ${s.args.join(" ")}` : s.url}
              </div>
              {s.last_error && <div className="mt-1 text-rose-300">{s.last_error}</div>}
            </li>
          ))}
        </ul>
      </div>
      <div className="overflow-y-auto px-3 py-2">
        {adding ? (
          <AddServer onDone={async () => { setAdding(false); await Promise.all([load(), refreshTools()]); }} onCancel={() => setAdding(false)} />
        ) : (
          <McpToolList servers={servers} />
        )}
      </div>
    </div>
  );
}

function McpToolList({ servers }: { servers: MCPServerInfo[] }) {
  const all = servers.flatMap((s) => s.tools.map((t) => ({ ...t, server: s.name })));
  if (!all.length) return <p className="text-muted">Tools from connected servers show up here and in the Tool node picker as <span className="font-mono">mcp:&lt;server&gt;:&lt;tool&gt;</span>.</p>;
  return (
    <table className="w-full">
      <thead className="text-muted">
        <tr>
          <th className="py-1 text-left font-normal">tool</th>
          <th className="py-1 text-left font-normal">arguments</th>
          <th className="py-1 text-left font-normal">description</th>
        </tr>
      </thead>
      <tbody>
        {all.map((t) => (
          <tr key={`${t.server}:${t.name}`} className="border-t border-edge/60 align-top">
            <td className="py-1 pr-3 font-mono text-fg">mcp:{t.server}:{t.name}</td>
            <td className="py-1 pr-3 font-mono text-accent">{Object.keys((t.input_schema?.properties as Record<string, unknown>) ?? {}).join(", ") || "–"}</td>
            <td className="py-1 text-muted">{t.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AddServer({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("npx -y @modelcontextprotocol/server-filesystem /tmp");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = "w-full rounded border border-edge bg-panel-2 px-2 py-1 text-fg outline-none focus:border-accent/55";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parts = command.trim().split(/\s+/);
      const srv = await api.addMcp(transport === "stdio" ? { name, transport, command: parts[0], args: parts.slice(1) } : { name, transport, url });
      if (srv.last_error) setError(srv.last_error);
      else onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-2">
      <div className="text-muted">Connect an MCP server</div>
      <label className="block">
        <span className="mb-0.5 block text-muted">name (used in tool ids)</span>
        <input value={name} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} placeholder="fs" className={`${field} font-mono`} />
      </label>
      <div className="grid grid-cols-2 gap-1 rounded-md border border-edge bg-panel-2 p-1">
        {(["stdio", "http"] as const).map((t) => (
          <button key={t} onClick={() => setTransport(t)} className={`rounded px-2 py-1 ${transport === t ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"}`}>
            {t === "stdio" ? "stdio (command)" : "http (url)"}
          </button>
        ))}
      </div>
      {transport === "stdio" ? (
        <label className="block">
          <span className="mb-0.5 block text-muted">command</span>
          <input value={command} onChange={(e) => setCommand(e.target.value)} className={`${field} font-mono`} />
          <span className="text-[10px] text-muted/70">runs on the API host; e.g. the official filesystem server above, or <span className="font-mono">uvx mcp-server-fetch</span></span>
        </label>
      ) : (
        <label className="block">
          <span className="mb-0.5 block text-muted">url</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" className={`${field} font-mono`} />
        </label>
      )}
      {error && <p className="text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-2 py-1 text-muted hover:text-fg">Cancel</button>
        <button onClick={submit} disabled={busy || !name || (transport === "stdio" ? !command : !url)} className="flex items-center gap-1 rounded-md bg-sky-500/20 px-3 py-1 text-sky-200 hover:bg-sky-500/30 disabled:opacity-40">
          <Plug size={11} /> {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
