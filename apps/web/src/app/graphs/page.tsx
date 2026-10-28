"use client";

import { Activity, AlertTriangle, ArrowRight, ArrowUpDown, BarChart3, BookOpen, Coins, CheckSquare, ChevronLeft, ChevronRight, Square as SquareIcon, Bot, Code2, Copy, Cpu, Flag, GitFork, Keyboard, LayoutGrid, Link2, Play, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, UserRound, Workflow, Wrench, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { GraphSummary, NodeType, RunInfo, TemplateInfo } from "@/lib/types";
import { API_URL } from "@/lib/api";
import { Logo } from "@/components/layout/Logo";

const starter = {
  name: "Untitled graph",
  nodes: [
    { id: "start", type: "start" as const, label: "Start", position: { x: 0, y: 0 }, config: {} },
    { id: "end", type: "end" as const, label: "End", position: { x: 0, y: 220 }, config: {} },
  ],
  edges: [],
};

const typeMeta: Record<NodeType, { icon: LucideIcon; cls: string; label: string }> = {
  start: { icon: Play, cls: "text-emerald-300 bg-emerald-400/10", label: "start" },
  end: { icon: Flag, cls: "text-rose-300 bg-rose-400/10", label: "end" },
  llm: { icon: Bot, cls: "text-sky-300 bg-sky-400/10", label: "model" },
  tool: { icon: Wrench, cls: "text-amber-300 bg-amber-400/10", label: "tool" },
  router: { icon: GitFork, cls: "text-violet-300 bg-violet-400/10", label: "router" },
  human: { icon: UserRound, cls: "text-pink-300 bg-pink-400/10", label: "human" },
  code: { icon: Code2, cls: "text-teal-300 bg-teal-400/10", label: "code" },
};

const templateIcon: Record<string, LucideIcon> = {
  "tweet-review": UserRound,
  "research-critic": BookOpen,
  "support-triage": GitFork,
  "pr-review": Code2,
};

type View = "overview" | "graphs" | "templates" | "runs" | "guide";
type Health = { groq?: boolean; gemini?: boolean; langfuse?: boolean; code_sandbox?: string; budget?: { used: number; limit: number | null } } | null;

/** "5 min ago", "2 h ago", "3 d ago" */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function TypeChips({ types, max = 7 }: { types: NodeType[]; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {types.slice(0, max).map((t) => {
        const m = typeMeta[t];
        return (
          <span key={t} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}>
            <m.icon size={10} /> {m.label}
          </span>
        );
      })}
    </div>
  );
}

export default function GraphsPage() {
  const [graphs, setGraphs] = useState<GraphSummary[] | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setViewState] = useState<View>("overview");
  const setView = (v: View) => {
    setViewState(v);
    window.history.replaceState(null, "", v === "overview" ? "/graphs" : `/graphs#${v}`);
  };
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"updated" | "name" | "nodes" | "issues">("updated");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [onlyReady, setOnlyReady] = useState(false);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [health, setHealth] = useState<Health>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const refresh = () => api.listGraphs().then(setGraphs).catch((e) => setError(String(e)));
  useEffect(() => {
    // the hash is not available during SSR; pick the view up after hydration
    const h = window.location.hash.replace("#", "");
    if (["graphs", "templates", "runs", "guide"].includes(h)) queueMicrotask(() => setViewState(h as View));
    refresh();
    api.listTemplates().then(setTemplates).catch(() => {});
    fetch(`${API_URL}/runs?limit=200`).then((r) => r.json()).then(setRuns).catch(() => {});
    fetch(`${API_URL}/health`).then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  const create = async () => router.push(`/graphs/${(await api.createGraph(starter)).id}`);
  const fromTemplate = async (slug: string) => router.push(`/graphs/${(await api.fromTemplate(slug)).id}`);
  const duplicate = async (id: string) => {
    await api.duplicateGraph(id);
    refresh();
  };
  const remove = async (id: string) => {
    await api.deleteGraph(id);
    refresh();
  };
  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const g = await api.createGraph({ name: data.name ?? file.name.replace(/\.json$/, ""), description: data.description, nodes: data.nodes ?? [], edges: data.edges ?? [] });
      router.push(`/graphs/${g.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `could not import: ${String(e)}`);
    }
  };

  const PAGE = 10;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (graphs ?? []).filter((g) => (!needle || g.name.toLowerCase().includes(needle)) && (!onlyReady || g.issues === 0));
    const by: Record<typeof sort, (a: GraphSummary, b: GraphSummary) => number> = {
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      name: (a, b) => a.name.localeCompare(b.name),
      nodes: (a, b) => b.nodes - a.nodes,
      issues: (a, b) => b.issues - a.issues,
    };
    return [...list].sort(by[sort]);
  }, [graphs, q, sort, onlyReady]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice(Math.min(page, pages - 1) * PAGE, Math.min(page, pages - 1) * PAGE + PAGE);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const removeMany = async () => {
    await Promise.all([...sel].map((id) => api.deleteGraph(id)));
    setSel(new Set());
    refresh();
  };
  const healthy = (graphs ?? []).filter((g) => g.issues === 0).length;

  return (
    <main className="relative min-h-full overflow-x-hidden">
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      <AppBar view={view} setView={setView} health={health} onImport={() => fileRef.current?.click()} onNew={create} />

      <div className="relative mx-auto w-full max-w-[1680px] px-4 pt-5 pb-12 md:px-6">
        {view === "overview" && (
          <section className="card relative mb-5 overflow-hidden">
            <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(70%_120%_at_20%_0%,black,transparent)]" />
            <div aria-hidden className="pointer-events-none absolute -top-24 -left-20 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
            <div className="relative flex flex-col gap-5 p-5 md:p-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
                  <Zap size={11} /> Time-travel debugging for agent workflows
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.02em] md:text-[34px]">
                  Build, run, <span className="text-accent">rewind.</span>
                </h1>
                <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
                  Compose multi-agent workflows on a canvas, watch them run live, then scrub back to any checkpoint, edit the state and fork from that step. Evals, model sweeps and MCP tools are built in.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <div className="card-2 flex items-center divide-x divide-edge-2 text-xs">
                  {[
                    ["graphs", graphs?.length ?? "–", ""],
                    ["ready", graphs ? healthy : "–", "text-emerald-300"],
                    ["templates", templates.length, ""],
                  ].map(([label, value, cls]) => (
                    <div key={String(label)} className="px-3.5 py-2">
                      <div className={`text-base font-semibold tabular-nums leading-none ${cls}`}>{value}</div>
                      <div className="mt-1 text-[10.5px] text-dim">{label}</div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setView("templates")} className="btn btn-ghost">
                  <Sparkles size={14} className="text-accent" /> Browse templates
                </button>
              </div>
            </div>
          </section>
        )}

        {error && <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

        {view === "overview" && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] 2xl:grid-cols-[minmax(0,1fr)_21rem]">
            <Dashboard runs={runs} graphs={graphs ?? []} templates={templates} fromTemplate={fromTemplate} />
            <RightRail runs={runs.slice(0, 6)} paused={runs.filter((r) => r.status === "paused").slice(0, 5)} graphs={graphs ?? []} health={health} />
          </div>
        )}

        {templates.length > 0 && view === "templates" && (
          <section id="templates">
            <SectionHead title="Start from a template" hint="one click, runs on free tiers" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {templates.map((t) => {
                const Icon = templateIcon[t.id] ?? Workflow;
                return (
                  <button key={t.id} onClick={() => fromTemplate(t.id)} className="card group relative flex flex-col p-5 text-left transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_12px_40px_-12px_rgb(197_241_53/0.25)]">
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition group-hover:bg-accent group-hover:text-accent-ink">
                        <Icon size={18} />
                      </span>
                      <span className="pill border border-edge-2 text-muted">{t.nodes} nodes</span>
                    </div>
                    <div className="mt-4 text-[15px] font-semibold tracking-tight">{t.name}</div>
                    <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">{t.description}</p>
                    <div className="mt-4 flex items-end justify-between gap-3 border-t border-edge pt-3">
                      <TypeChips types={t.node_types} />
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-dim transition group-hover:text-accent">
                        Use <ArrowRight size={13} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {view === "runs" && <RunsTable runs={runs} graphs={graphs ?? []} />}
        {view === "guide" && <Guide />}
        {view === "graphs" && (
          <section id="graphs">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">Your graphs</h2>
                <p className="text-xs text-muted">{shown.length} graph{shown.length === 1 ? "" : "s"}{graphs && shown.length !== graphs.length ? ` of ${graphs.length}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="input flex w-56 items-center gap-2 py-0 pr-2 text-xs text-muted">
                  <Search size={13} className="shrink-0" />
                  <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search graphs" className="h-[2.1rem] w-full bg-transparent text-fg outline-none placeholder:text-dim" />
                </label>
                <button onClick={() => { setOnlyReady((v) => !v); setPage(0); }} className={`btn btn-sm ${onlyReady ? "border border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "btn-ghost"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${onlyReady ? "bg-emerald-400" : "bg-dim"}`} /> ready only
                </button>
                <button onClick={create} className="btn btn-sm btn-primary"><Plus size={14} /> New</button>
              </div>
            </div>

            {graphs && graphs.length === 0 && (
              <div className="card border-dashed p-10 text-center text-sm text-muted">No graphs yet. Pick a template or create a blank one.</div>
            )}
            {graphs && graphs.length > 0 && shown.length === 0 && <p className="mb-3 text-sm text-muted">Nothing matches “{q}”.</p>}

            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-panel-2/60">
                  <tr className="eyebrow">
                    <th className="w-10 px-3 py-2.5">
                      <button onClick={() => setSel(sel.size === pageRows.length ? new Set() : new Set(pageRows.map((g) => g.id)))} className="text-dim hover:text-fg" title="Select page">
                        {sel.size > 0 && sel.size === pageRows.length ? <CheckSquare size={14} /> : <SquareIcon size={14} />}
                      </button>
                    </th>
                    {(
                      [
                        ["name", "Name", "text-left"],
                        ["nodes", "Nodes", "text-right"],
                        ["issues", "Status", "text-left"],
                        ["updated", "Updated", "text-left"],
                      ] as const
                    ).map(([key, label, align]) => (
                      <th key={key} className={`px-3 py-2.5 ${align} ${key === "name" ? "w-1/2" : ""}`}>
                        <button onClick={() => setSort(key)} className={`eyebrow inline-flex items-center gap-1 hover:text-fg ${sort === key ? "text-fg" : ""}`}>
                          {label} <ArrowUpDown size={11} className={sort === key ? "opacity-100" : "opacity-30"} />
                        </button>
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right">v</th>
                    <th className="w-24 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((g) => (
                    <tr key={g.id} className={`group border-t border-edge transition hover:bg-panel-2/70 ${sel.has(g.id) ? "bg-accent/5" : ""}`}>
                      <td className="px-3 py-2.5">
                        <button onClick={() => toggle(g.id)} className={sel.has(g.id) ? "text-accent" : "text-dim hover:text-fg"}>
                          {sel.has(g.id) ? <CheckSquare size={14} /> : <SquareIcon size={14} />}
                        </button>
                      </td>
                      <td className="max-w-0 px-3 py-2.5">
                        <Link href={`/graphs/${g.id}`} className="flex items-center gap-2.5">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-panel-3 text-muted ring-1 ring-edge-2 transition group-hover:bg-accent/15 group-hover:text-accent group-hover:ring-accent/30"><Workflow size={13} /></span>
                          <span className="truncate font-medium text-fg" title={g.name}>{g.name}</span>
                          {g.shared && <Link2 size={12} className="shrink-0 text-accent" aria-label="shared with a link" />}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{g.nodes}</td>
                      <td className="px-3 py-2.5">
                        {g.issues > 0 ? (
                          <span className="pill bg-amber-400/10 text-amber-300"><AlertTriangle size={10} /> {g.issues} issue{g.issues > 1 ? "s" : ""}</span>
                        ) : (
                          <span className="pill bg-emerald-400/10 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> ready</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted">{new Date(g.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[11px] text-dim">v{g.version}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
                          <Link href={`/graphs/${g.id}`} className="icon-btn" title="Open"><ArrowRight size={13} /></Link>
                          <button onClick={() => duplicate(g.id)} className="icon-btn" title="Duplicate"><Copy size={13} /></button>
                          <button onClick={() => remove(g.id)} className="icon-btn hover:!text-rose-400" title="Delete"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-3 border-t border-edge bg-panel-2/40 px-3 py-2 text-xs text-muted">
                {sel.size > 0 ? (
                  <>
                    <span className="text-fg">{sel.size} selected</span>
                    <button onClick={removeMany} className="btn btn-sm btn-danger"><Trash2 size={12} /> Delete selected</button>
                    <button onClick={() => setSel(new Set())} className="hover:text-fg">clear</button>
                  </>
                ) : (
                  <span>page {Math.min(page, pages - 1) + 1} of {pages}</span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="icon-btn"><ChevronLeft size={14} /></button>
                  <span className="tabular-nums">{Math.min(page, pages - 1) + 1} / {pages}</span>
                  <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="icon-btn"><ChevronRight size={14} /></button>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function AppBar({ view, setView, health, onImport, onNew }: { view: View; setView: (v: View) => void; health: Health; onImport: () => void; onNew: () => void }) {
  const items: [LucideIcon, string, View][] = [
    [LayoutGrid, "Overview", "overview"],
    [Workflow, "Graphs", "graphs"],
    [Sparkles, "Templates", "templates"],
    [Activity, "Runs", "runs"],
    [BookOpen, "How it works", "guide"],
  ];
  const online = !!health?.groq;
  return (
    <header className="glass sticky top-0 z-30 border-b border-edge">
      <div className="mx-auto flex h-14 w-full max-w-[1680px] items-center gap-3 px-4 md:px-6">
        <button onClick={() => setView("overview")} className="flex items-center gap-2.5 pr-2">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Agent Studio</span>
        </button>
        <nav className="ml-2 hidden h-full items-stretch md:flex">
          {items.map(([Icon, label, key]) => (
            <button key={key} data-active={view === key} onClick={() => setView(key)} className={`tab-underline flex items-center gap-1.5 px-3 text-[13px] font-medium transition ${view === key ? "text-fg" : "text-muted hover:text-fg"}`}>
              <Icon size={14} className={view === key ? "text-accent" : ""} /> {label}
            </button>
          ))}
        </nav>
        <select value={view} onChange={(e) => setView(e.target.value as View)} className="input ml-1 w-auto py-1 text-xs md:hidden">
          {items.map(([, label, key]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="pill hidden border border-edge-2 bg-panel-2 text-muted sm:inline-flex" title={health ? (online ? "Groq models connected" : "no model key configured") : "checking…"}>
            <span className={`h-1.5 w-1.5 rounded-full ${health ? (online ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/70" : "bg-amber-400") : "bg-dim"}`} />
            {health ? (online ? "Models online" : "No model key") : "Checking"}
          </span>
          <button onClick={onImport} className="btn btn-ghost" title="Import a graph JSON exported from the editor"><Upload size={14} /> Import</button>
          <button onClick={onNew} className="btn btn-primary"><Plus size={15} strokeWidth={2.5} /> New graph</button>
        </div>
      </div>
    </header>
  );
}

const runTone: Record<string, string> = { done: "bg-emerald-400", error: "bg-rose-400", paused: "bg-pink-400", running: "bg-sky-400", cancelled: "bg-amber-400", queued: "bg-zinc-500" };

function RightRail({ runs, paused, graphs, health }: { runs: RunInfo[]; paused: RunInfo[]; graphs: GraphSummary[]; health: Health }) {
  const nameOf = Object.fromEntries(graphs.map((g) => [g.id, g.name]));
  const totalCost = runs.reduce((a, r) => a + (r.usage?.cost_usd ?? 0), 0);
  return (
    <aside className="flex min-w-0 flex-col gap-4">
      <section id="runs" className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Activity size={14} className="text-accent" /> Recent runs</h3>
          <span className="text-[11px] text-dim">last {runs.length}</span>
        </div>
        {!runs.length && <p className="text-xs text-muted">No runs yet. Open a graph and press Run.</p>}
        <ul className="-mx-2 space-y-0.5">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/graphs/${r.graph_id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-panel-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${runTone[r.status] ?? "bg-zinc-500"}`} />
                <span className="min-w-0 flex-1 truncate text-fg">{nameOf[r.graph_id] ?? "graph"}</span>
                <span className="shrink-0 text-muted">{r.status}</span>
                <span className="w-10 shrink-0 text-right font-mono text-[10.5px] text-dim">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
        {runs.length > 0 && <div className="mt-3 flex justify-between border-t border-edge pt-2.5 text-[11px] text-muted"><span>spent on these runs</span><b className="font-mono text-fg">${totalCost.toFixed(5)}</b></div>}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><UserRound size={14} className="text-pink-300" /> Needs attention</h3>
          {paused.length > 0 && <span className="pill bg-pink-400/10 text-pink-300">{paused.length} paused</span>}
        </div>
        {!paused.length && <p className="text-xs text-muted">No runs are waiting on you.</p>}
        <ul className="-mx-2 space-y-0.5">
          {paused.map((r) => (
            <li key={r.id}>
              <Link href={`/graphs/${r.graph_id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-panel-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-pink-400 shadow-[0_0_8px] shadow-pink-400/60" />
                <span className="min-w-0 flex-1 truncate text-fg">{nameOf[r.graph_id] ?? "graph"}</span>
                <span className="shrink-0 text-dim">{ago(r.created_at)}</span>
                <ArrowRight size={12} className="shrink-0 text-dim" />
              </Link>
            </li>
          ))}
        </ul>
      </section>


      <section className="card relative overflow-hidden p-4 text-xs leading-relaxed text-muted">
        <div aria-hidden className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-accent/15 blur-2xl" />
        <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg"><ShieldCheck size={14} className="text-accent" /> Free-tier friendly</h3>
        Runs cost about <b className="font-mono text-fg">$0.00007</b> each on Groq. Evals run 3 rows at a time and sweeps go model by model, so free rate limits hold.
      </section>


      <section className="card flex flex-1 flex-col p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Cpu size={14} className="text-accent" /> System</h3>
        <ul className="space-y-2 text-xs">
          {[
            ["Groq models", health?.groq, health ? (health.groq ? "connected" : "no key") : "…"],
            ["Gemini", health?.gemini, health ? (health.gemini ? "connected" : "optional") : "…"],
            ["Tracing (Langfuse)", health?.langfuse, health ? (health.langfuse ? "on" : "optional") : "…"],
            ["Code sandbox", health?.code_sandbox === "docker", health?.code_sandbox ?? "…"],
          ].map(([label, ok, text]) => (
            <li key={String(label)} className="flex items-center justify-between">
              <span className="text-muted">{label}</span>
              <span className={`flex items-center gap-1.5 ${ok ? "text-emerald-300" : "text-dim"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-edge-2"}`} /> {text}
              </span>
            </li>
          ))}
        </ul>
        {health?.budget && (
          <div className="mt-auto border-t border-edge pt-2.5">
            <div className="mb-1.5 flex justify-between text-[11px] text-muted"><span>model calls today</span><span className="font-mono text-fg">{health.budget.used}{health.budget.limit ? ` / ${health.budget.limit}` : ""}</span></div>
            {health.budget.limit && <div className="h-1.5 overflow-hidden rounded-full bg-panel-3"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, Math.min(100, (health.budget.used / health.budget.limit) * 100))}%` }} /></div>}
          </div>
        )}
      </section>
    </aside>
  );
}

function RunsTable({ runs, graphs }: { runs: RunInfo[]; graphs: GraphSummary[] }) {
  const nameOf = Object.fromEntries(graphs.map((g) => [g.id, g.name]));
  const [filter, setFilter] = useState<string>("");
  const [pg, setPg] = useState(0);
  const all = runs.filter((r) => !filter || r.status === filter);
  const pages = Math.max(1, Math.ceil(all.length / 12));
  const rows = all.slice(Math.min(pg, pages - 1) * 12, Math.min(pg, pages - 1) * 12 + 12);
  const cost = all.reduce((a, r) => a + (r.usage?.cost_usd ?? 0), 0);
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Runs across all graphs</h2>
          <p className="text-xs text-muted">{all.length} runs · total cost <b className="font-mono text-fg">${cost.toFixed(5)}</b></p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-edge-2 bg-panel-2 p-0.5 text-xs">
          {["", "done", "paused", "running", "error", "cancelled"].map((s) => (
            <button key={s} onClick={() => { setFilter(s); setPg(0); }} className={`rounded-md px-2 py-1 capitalize transition ${filter === s ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`}>{s || "all"}</button>
          ))}
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel-2/60">
            <tr className="eyebrow">
              <th className="w-1/2 px-3 py-2.5 text-left">Graph</th>
              <th className="px-3 py-2.5 text-left">Status</th>
              <th className="px-3 py-2.5 text-right">Time</th>
              <th className="px-3 py-2.5 text-right">Calls</th>
              <th className="px-3 py-2.5 text-right">Cost</th>
              <th className="px-3 py-2.5 text-left">Started</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted">No runs yet. Open a graph and press Run.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="group border-t border-edge transition hover:bg-panel-2/70">
                <td className="max-w-0 px-3 py-2.5">
                  <Link href={`/graphs/${r.graph_id}`} className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg">{nameOf[r.graph_id] ?? "deleted graph"}</span>
                    {r.parent_run_id && <span className="pill bg-violet-400/10 text-violet-300">fork</span>}
                    <span className="shrink-0 font-mono text-[10px] text-dim">{r.id.slice(0, 8)}</span>
                  </Link>
                </td>
                <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5 text-xs text-muted"><span className={`h-2 w-2 rounded-full ${runTone[r.status] ?? "bg-zinc-500"}`} /> {r.status}</span></td>
                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-muted">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "–"}</td>
                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-muted">{r.usage?.llm_calls ?? 0}</td>
                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-muted">${(r.usage?.cost_usd ?? 0).toFixed(6)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted">{new Date(r.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-4 border-t border-edge bg-panel-2/40 px-3 py-2 text-xs text-muted">
          <span>page {Math.min(pg, pages - 1) + 1} of {pages}</span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setPg((p) => Math.max(0, p - 1))} disabled={pg === 0} className="icon-btn"><ChevronLeft size={14} /></button>
            <span className="tabular-nums">{Math.min(pg, pages - 1) + 1} / {pages}</span>
            <button onClick={() => setPg((p) => Math.min(pages - 1, p + 1))} disabled={pg >= pages - 1} className="icon-btn"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Guide() {
  const steps: [LucideIcon, string, string][] = [
    [LayoutGrid, "Compose", "Drag nodes onto the canvas: model, tool, router, human gate, code. Prompts reference variables as {{name}}; the inspector shows what is in scope."],
    [Play, "Run", "Press ⌘↵. Tokens stream inside the node that generates them, edges light up as data flows, and human nodes pause the run with a card showing exactly what to approve."],
    [Activity, "Time-travel", "Open the State tab: scrub through every checkpoint, see what each step changed, edit a variable and fork a new run from that step. Compare the two side by side."],
    [ShieldCheck, "Eval and ship", "Build a dataset, pick scorers, run an eval; failures light up the node that caused them. Sweep candidate models for a node and apply the cheapest one that still passes."],
  ];
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">How it works</h2>
        <p className="mt-1 text-sm text-muted">Four loops, one canvas. Everything below runs on free tiers.</p>
      </div>
      <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map(([Icon, title, body], i) => (
          <li key={title} className="card relative p-5">
            <span className="absolute top-4 right-4 font-mono text-[11px] text-dim">0{i + 1}</span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20"><Icon size={16} /></span>
            <div className="mt-3 text-sm font-semibold">{title}</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5 text-[13px] text-muted">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg"><Keyboard size={14} className="text-accent" /> Shortcuts</div>
          {[["⌘K", "command palette"], ["⌘↵", "run the graph"], ["⌘Z / ⇧⌘Z", "undo / redo"], ["⌫", "delete selection"], ["drag from a handle", "connect nodes"]].map(([k, v]) => (
            <div key={k} className="flex justify-between border-t border-edge py-2 first:border-0"><span>{v}</span><kbd className="kbd">{k}</kbd></div>
          ))}
        </div>
        <div className="card p-5 text-[13px] leading-relaxed text-muted">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg"><Cpu size={14} className="text-accent" /> Under the hood</div>
          Each node completion is a LangGraph checkpoint in Postgres. A run is a pointer to the head of a checkpoint chain plus the events it emitted; forking creates a new checkpoint whose parent is the one you edited. Console, timeline, cost and traces all derive from the same event log.
        </div>
      </div>
    </section>
  );
}

const statusColors: Record<string, string> = { done: "#34d399", error: "#fb7185", paused: "#f472b6", running: "#38bdf8", cancelled: "#fbbf24", queued: "#71717a" };

function Donut({ parts, size = 116 }: { parts: [string, number, string][]; size?: number }) {
  const total = parts.reduce((a, p) => a + p[1], 0) || 1;
  const r = size / 2 - 9, c = 2 * Math.PI * r;
  // precompute arc offsets: no mutation during render
  const arcs = parts.reduce<{ label: string; color: string; len: number; offset: number }[]>((acc, [label, v, color]) => {
    const offset = acc.reduce((a, x) => a + x.len, 0);
    return [...acc, { label, color, len: (v / total) * c, offset }];
  }, []);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={12} />
      {arcs.map((a) => (
        <circle key={a.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.color} strokeWidth={12} strokeDasharray={`${Math.max(0, a.len - 2)} ${c - Math.max(0, a.len - 2)}`} strokeDashoffset={-a.offset} />
      ))}
    </svg>
  );
}

function Bars({ rows, color = "var(--accent)", fmt = (v: number) => String(v) }: { rows: [string, string, number][]; color?: string; fmt?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r[2]), 1);
  return (
    <div className="space-y-2">
      {rows.map(([id, label, v]) => (
        <div key={id} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2 text-[11px]">
          <span className="truncate text-muted" title={label}>{label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-panel-3"><div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: color }} /></div>
          <span className="text-right font-mono tabular-nums text-fg">{fmt(v)}</span>
        </div>
      ))}
      {!rows.length && <p className="text-[11px] text-dim">no data yet</p>}
    </div>
  );
}

function CardHead({ icon: Icon, title, hint }: { icon?: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-sm font-semibold">{Icon && <Icon size={14} className="text-accent" />} {title}</div>
      {hint && <span className="text-[11px] text-dim">{hint}</span>}
    </div>
  );
}

function Dashboard({ runs, graphs, templates, fromTemplate }: { runs: RunInfo[]; graphs: GraphSummary[]; templates: TemplateInfo[]; fromTemplate: (slug: string) => void }) {
  const nameOf = Object.fromEntries(graphs.map((g) => [g.id, g.name]));
  const recent = [...graphs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
  const graphsWithRuns = new Set(runs.map((r) => r.graph_id)).size;
  const byStatus: Record<string, number> = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const done = byStatus.done ?? 0, finished = done + (byStatus.error ?? 0) + (byStatus.cancelled ?? 0);
  const cost = runs.reduce((a, r) => a + (r.usage?.cost_usd ?? 0), 0);
  const calls = runs.reduce((a, r) => a + (r.usage?.llm_calls ?? 0), 0);
  const durations = runs.filter((r) => r.duration_ms != null && r.status === "done").map((r) => r.duration_ms as number).sort((a, b) => a - b);
  const p50 = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const perGraph: Record<string, number> = {};
  for (const r of runs) perGraph[r.graph_id] = (perGraph[r.graph_id] ?? 0) + 1;
  const topGraphs = Object.entries(perGraph).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => [id, nameOf[id] ?? "deleted graph", n] as [string, string, number]);
  const costGraph: Record<string, number> = {};
  for (const r of runs) costGraph[r.graph_id] = (costGraph[r.graph_id] ?? 0) + (r.usage?.cost_usd ?? 0);
  const topCost = Object.entries(costGraph).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => [id, nameOf[id] ?? "deleted graph", v] as [string, string, number]);
  const byHour: Record<string, number> = {};
  for (const r of runs) { const h = new Date(r.created_at); const k = `${h.getDate()}/${h.getMonth() + 1} ${String(h.getHours()).padStart(2, "0")}h`; byHour[k] = (byHour[k] ?? 0) + 1; }
  const hours = Object.entries(byHour).slice(0, 10).reverse() as [string, number][];
  const kpis: [LucideIcon, string, string, string][] = [
    [LayoutGrid, "Graphs", String(graphs.length), `${graphs.filter((g) => g.issues === 0).length} ready`],
    [Activity, "Runs", String(runs.length), `${byStatus.paused ?? 0} waiting on a human`],
    [ShieldCheck, "Success rate", finished ? `${Math.round((done / finished) * 100)}%` : "–", `${byStatus.error ?? 0} errors`],
    [Coins, "Spend", `$${cost.toFixed(4)}`, `${calls} model calls · p50 ${p50 != null ? (p50 / 1000).toFixed(1) + " s" : "–"}`],
  ];
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="card grid grid-cols-2 divide-y divide-edge md:grid-cols-4 md:divide-x md:divide-y-0">
        {kpis.map(([Icon, label, value, sub]) => (
          <div key={label} className="p-4">
            <div className="eyebrow flex items-center gap-1.5"><Icon size={12} className="text-accent" /> {label}</div>
            <div className="mt-2 text-[26px] font-semibold tabular-nums leading-none tracking-tight">{value}</div>
            <div className="mt-1.5 text-[11px] text-muted">{sub}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <CardHead title="Run outcomes" hint={`${runs.length} runs`} />
          <div className="flex items-center gap-4">
            <Donut parts={Object.entries(byStatus).map(([k, v]) => [k, v, statusColors[k] ?? "#71717a"])} />
            <ul className="space-y-1.5 text-[11px]">
              {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: statusColors[k] ?? "#71717a" }} /><span className="w-16 text-muted">{k}</span><span className="font-mono tabular-nums text-fg">{v}</span><span className="font-mono text-dim">{Math.round((v / (runs.length || 1)) * 100)}%</span></li>
              ))}
              {!runs.length && <li className="text-dim">no runs yet</li>}
            </ul>
          </div>
        </div>
        <div className="card p-4">
          <CardHead icon={BarChart3} title="Runs per graph" hint="top 5" />
          <Bars rows={topGraphs} />
          <div className="mt-3 flex justify-between border-t border-edge pt-2.5 text-[11px] text-muted"><span>graphs with runs</span><b className="font-mono text-fg">{graphsWithRuns} / {graphs.length}</b></div>
        </div>
        <div className="card p-4">
          <CardHead icon={Coins} title="Spend per graph" hint="USD" />
          <Bars rows={topCost} color="#fbbf24" fmt={(v) => `$${v.toFixed(5)}`} />
          <div className="mt-3 flex justify-between border-t border-edge pt-2.5 text-[11px] text-muted"><span>average per run</span><b className="font-mono text-fg">${runs.length ? (cost / runs.length).toFixed(6) : "0"}</b></div>
        </div>
      </div>
      <div className="card p-4">
        <CardHead title="Activity by hour" hint="runs started" />
        <div className="flex h-28 items-end gap-2">
          {hours.map(([k, v]) => { const max = Math.max(...hours.map((h) => h[1]), 1); return (
            <div key={k} className="group flex flex-1 flex-col items-center gap-1.5" title={`${v} runs`}>
              <span className="font-mono text-[10px] text-dim opacity-0 transition group-hover:opacity-100">{v}</span>
              <div className="w-full rounded-t-md bg-accent/70 transition group-hover:bg-accent" style={{ height: `${Math.max(4, (v / max) * 72)}px` }} />
              <span className="font-mono text-[9.5px] text-dim">{k}</span>
            </div>
          ); })}
          {!hours.length && <p className="text-[11px] text-dim">no runs yet</p>}
        </div>
      </div>
      <div className="grid flex-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <div className="card min-w-0 p-4">
          <CardHead icon={Workflow} title="Recently edited" hint={`last ${recent.length}`} />
          <ul className="-mx-2 divide-y divide-edge">
            {recent.map((g) => (
              <li key={g.id}>
                <Link href={`/graphs/${g.id}`} className="group flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs transition hover:bg-panel-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-panel-3 text-muted ring-1 ring-edge-2 transition group-hover:bg-accent/15 group-hover:text-accent"><Workflow size={12} /></span>
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">{g.name}</span>
                  <span className="hidden font-mono text-[10.5px] text-dim sm:inline">{g.nodes} nodes</span>
                  {g.issues > 0 ? <span className="pill bg-amber-400/10 text-amber-300">{g.issues} issue{g.issues > 1 ? "s" : ""}</span> : <span className="pill bg-emerald-400/10 text-emerald-300">ready</span>}
                  <span className="w-16 shrink-0 text-right text-[10.5px] text-dim">{ago(g.updated_at)}</span>
                  <ArrowRight size={13} className="shrink-0 text-dim transition group-hover:text-accent" />
                </Link>
              </li>
            ))}
            {!recent.length && <li className="px-2 py-2 text-[11px] text-dim">No graphs yet.</li>}
          </ul>
        </div>
        <div className="card min-w-0 p-4">
          <CardHead icon={Sparkles} title="Start from a template" hint="one click" />
          <ul className="-mx-2 divide-y divide-edge">
            {templates.map((t) => {
              const Icon = templateIcon[t.id] ?? Workflow;
              return (
                <li key={t.id}>
                  <button onClick={() => fromTemplate(t.id)} className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition hover:bg-panel-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20 transition group-hover:bg-accent group-hover:text-accent-ink"><Icon size={14} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg">{t.name}</span>
                      <span className="block truncate text-[10.5px] text-dim">{t.description}</span>
                    </span>
                    <span className="pill hidden border border-edge-2 text-muted sm:inline-flex">{t.nodes} nodes</span>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-dim transition group-hover:text-accent">Use <ArrowRight size={12} /></span>
                  </button>
                </li>
              );
            })}
            {!templates.length && <li className="px-2 py-2 text-[11px] text-dim">No templates available.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
