"use client";

import { Activity, AlertTriangle, ArrowRight, ArrowUpDown, BarChart3, BookOpen, Coins, CheckSquare, ChevronLeft, ChevronRight, Square as SquareIcon, Bot, Code2, Copy, Cpu, Flag, GitFork, Keyboard, LayoutGrid, Link2, Play, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, UserRound, Workflow, Wrench, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { GraphSummary, NodeType, RunInfo, TemplateInfo } from "@/lib/types";
import { API_URL } from "@/lib/api";

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

const templateArt: Record<string, string> = {
  "tweet-review": "from-pink-500/30 via-sky-500/10 to-transparent",
  "research-critic": "from-amber-500/30 via-violet-500/10 to-transparent",
  "support-triage": "from-violet-500/30 via-pink-500/10 to-transparent",
  "pr-review": "from-sky-500/30 via-teal-500/10 to-transparent",
};

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
  type View = "overview" | "graphs" | "templates" | "runs" | "guide";
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
  const [health, setHealth] = useState<{ groq?: boolean; gemini?: boolean; langfuse?: boolean; code_sandbox?: string; budget?: { used: number; limit: number | null } } | null>(null);
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
      {/* ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_50%_at_50%_0%,rgb(56_189_248/0.18),transparent_70%)]" />
      <div aria-hidden className="pointer-events-none absolute -left-40 top-40 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-40 top-80 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative mx-auto grid max-w-[1600px] grid-cols-1 gap-8 px-6 pt-8 pb-24 lg:grid-cols-[13rem_minmax(0,1fr)_19rem]">
        <SideNav view={view} setView={setView} />
        <div className="min-w-0">
        {/* hero */}
        {view === "overview" && (
        <header id="how" className="mb-12 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-edge bg-panel/60 px-3 py-1 text-[11px] font-medium tracking-wide text-muted backdrop-blur">
              <Sparkles size={12} className="text-sky-300" /> Chrome DevTools for AI agents
            </div>
            <h1 className="flex items-center gap-3 text-4xl font-semibold tracking-tight">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-sky-400/30 to-violet-500/30 text-sky-200 ring-1 ring-white/10">
                <Workflow size={22} />
              </span>
              <span className="bg-gradient-to-r from-white via-white to-sky-200 bg-clip-text text-transparent">Agent Studio</span>
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
              Build multi-agent workflows on a canvas, watch them run, then <span className="text-fg">rewind any run, edit its state and fork from that step</span>. Evals, model sweeps and MCP tools built in.
            </p>
            <div className="mt-4 flex items-center gap-4 text-xs text-muted">
              <span><b className="text-fg">{graphs?.length ?? "–"}</b> graphs</span>
              <span className="h-3 w-px bg-edge" />
              <span><b className="text-emerald-300">{graphs ? healthy : "–"}</b> ready to run</span>
              <span className="h-3 w-px bg-edge" />
              <span><b className="text-fg">{templates.length}</b> templates</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-edge bg-panel/60 px-3.5 py-2.5 text-sm text-muted backdrop-blur transition hover:border-white/20 hover:text-fg" title="Import a graph JSON exported from the editor">
              <Upload size={15} /> Import
            </button>
            <button onClick={create} className="group flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:shadow-sky-500/40">
              <Plus size={15} /> New graph
            </button>
          </div>
        </header>
        )}

        {error && <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

        {/* templates */}
        {view === "overview" && <Dashboard runs={runs} graphs={graphs ?? []} />}
        {templates.length > 0 && view === "templates" && (
          <section id="templates" className="mb-14 scroll-mt-8">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Start from a template</h2>
              <span className="text-xs text-muted">one click, runs on free tiers</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {templates.map((t) => (
                <button key={t.id} onClick={() => fromTemplate(t.id)} className="group relative overflow-hidden rounded-2xl border border-edge bg-panel p-5 text-left transition hover:-translate-y-0.5 hover:border-sky-400/40 hover:shadow-2xl hover:shadow-sky-500/10">
                  <div aria-hidden className={`pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-gradient-to-br ${templateArt[t.id] ?? "from-sky-500/30 to-transparent"} blur-2xl transition group-hover:scale-125`} />
                  <div className="relative">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[15px] font-semibold tracking-tight">{t.name}</div>
                      <span className="shrink-0 rounded-full border border-edge px-2 py-0.5 text-[10px] text-muted">{t.nodes} nodes</span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t.description}</p>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <TypeChips types={t.node_types} />
                      <span className="flex items-center gap-1 text-xs font-medium text-sky-300 opacity-0 transition group-hover:opacity-100">
                        Use template <ArrowRight size={13} />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* graphs */}
        {view === "runs" && <RunsTable runs={runs} graphs={graphs ?? []} />}
        {view === "guide" && <Guide />}
        {view === "graphs" && (
        <section id="graphs" className="scroll-mt-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold tracking-tight">Your graphs</h2>
            <label className="flex items-center gap-2 rounded-lg border border-edge bg-panel/60 px-3 py-1.5 text-xs text-muted focus-within:border-sky-500/50">
              <Search size={13} />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search graphs" className="w-44 bg-transparent text-fg outline-none placeholder:text-muted/60" />
            </label>
          </div>

          {graphs && graphs.length === 0 && (
            <div className="rounded-2xl border border-dashed border-edge p-10 text-center text-sm text-muted">
              No graphs yet. Pick a template above or create a blank one.
            </div>
          )}
          {graphs && graphs.length > 0 && shown.length === 0 && <p className="text-sm text-muted">Nothing matches “{q}”.</p>}

          <div className="overflow-hidden rounded-2xl border border-edge bg-panel">
            <table className="w-full text-sm">
              <thead className="bg-white/[.02] text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="w-9 px-3 py-2.5">
                    <button onClick={() => setSel(sel.size === pageRows.length ? new Set() : new Set(pageRows.map((g) => g.id)))} className="text-muted hover:text-fg" title="Select page">
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
                    <th key={key} className={`px-3 py-2.5 font-medium ${align} ${key === "name" ? "w-1/2" : ""}`}>
                      <button onClick={() => setSort(key)} className={`inline-flex items-center gap-1 hover:text-fg ${sort === key ? "text-fg" : ""}`}>
                        {label} <ArrowUpDown size={11} className={sort === key ? "opacity-100" : "opacity-30"} />
                      </button>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-medium">v</th>
                  <th className="w-24 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((g) => (
                  <tr key={g.id} className={`group border-t border-edge/70 transition hover:bg-white/[.03] ${sel.has(g.id) ? "bg-sky-500/5" : ""}`}>
                    <td className="px-3 py-2">
                      <button onClick={() => toggle(g.id)} className={sel.has(g.id) ? "text-sky-300" : "text-muted/60 hover:text-fg"}>
                        {sel.has(g.id) ? <CheckSquare size={14} /> : <SquareIcon size={14} />}
                      </button>
                    </td>
                    <td className="max-w-0 px-3 py-2">
                      <Link href={`/graphs/${g.id}`} className="flex items-center gap-2">
                        <span className="truncate font-medium text-fg group-hover:text-sky-200" title={g.name}>{g.name}</span>
                        {g.shared && <Link2 size={12} className="shrink-0 text-sky-300" aria-label="shared with a link" />}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{g.nodes}</td>
                    <td className="px-3 py-2">
                      {g.issues > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300"><AlertTriangle size={10} /> {g.issues} issue{g.issues > 1 ? "s" : ""}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> ready</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted">{new Date(g.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-muted">v{g.version}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
                        <Link href={`/graphs/${g.id}`} className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-sky-300" title="Open"><ArrowRight size={13} /></Link>
                        <button onClick={() => duplicate(g.id)} className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg" title="Duplicate"><Copy size={13} /></button>
                        <button onClick={() => remove(g.id)} className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-rose-400" title="Delete"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-3 border-t border-edge px-3 py-2 text-xs text-muted">
              {sel.size > 0 ? (
                <>
                  <span className="text-fg">{sel.size} selected</span>
                  <button onClick={removeMany} className="flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-1 text-rose-300 hover:bg-rose-500/25"><Trash2 size={12} /> Delete selected</button>
                  <button onClick={() => setSel(new Set())} className="hover:text-fg">clear</button>
                </>
              ) : (
                <span>{shown.length} graph{shown.length === 1 ? "" : "s"}{graphs && shown.length !== graphs.length ? ` of ${graphs.length}` : ""}</span>
              )}
              <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={onlyReady} onChange={(e) => { setOnlyReady(e.target.checked); setPage(0); }} /> ready only</label>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded p-1 hover:text-fg disabled:opacity-30"><ChevronLeft size={14} /></button>
                <span className="tabular-nums">{Math.min(page, pages - 1) + 1} / {pages}</span>
                <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="rounded p-1 hover:text-fg disabled:opacity-30"><ChevronRight size={14} /></button>
              </div>
            </div>
          </div>
        </section>
        )}
        </div>
        {view === "overview" ? <RightRail runs={runs.slice(0, 8)} graphs={graphs ?? []} health={health} /> : <div className="hidden lg:block" />}
      </div>
    </main>
  );
}

function SideNav({ view, setView }: { view: string; setView: (v: "overview" | "graphs" | "templates" | "runs" | "guide") => void }) {
  const items: [LucideIcon, string, "overview" | "graphs" | "templates" | "runs" | "guide"][] = [
    [Workflow, "Overview", "overview"],
    [LayoutGrid, "Graphs", "graphs"],
    [Sparkles, "Templates", "templates"],
    [Activity, "Runs", "runs"],
    [BookOpen, "How it works", "guide"],
  ];
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-8 space-y-6">
        <div className="flex items-center gap-2 px-2 text-sm font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-sky-400/30 to-violet-500/30 text-sky-200 ring-1 ring-white/10">
            <Workflow size={15} />
          </span>
          Agent Studio
        </div>
        <nav className="space-y-0.5">
          {items.map(([Icon, label, key]) => (
            <button key={key} onClick={() => setView(key)} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${view === key ? "bg-sky-500/10 text-sky-200 ring-1 ring-sky-500/20" : "text-muted hover:bg-white/5 hover:text-fg"}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>
        <div className="rounded-xl border border-edge bg-panel/60 p-3 text-[11px] leading-relaxed text-muted">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium text-fg"><Keyboard size={12} /> Shortcuts</div>
          <div><kbd className="rounded border border-edge px-1 font-mono">⌘K</kbd> commands</div>
          <div><kbd className="rounded border border-edge px-1 font-mono">⌘↵</kbd> run graph</div>
          <div><kbd className="rounded border border-edge px-1 font-mono">⌘Z</kbd> undo · <kbd className="rounded border border-edge px-1 font-mono">⌫</kbd> delete</div>
        </div>
      </div>
    </aside>
  );
}

const runTone: Record<string, string> = { done: "bg-emerald-400", error: "bg-rose-400", paused: "bg-pink-400", running: "bg-sky-400", cancelled: "bg-amber-400", queued: "bg-zinc-500" };

function RightRail({ runs, graphs, health }: { runs: RunInfo[]; graphs: GraphSummary[]; health: { groq?: boolean; gemini?: boolean; langfuse?: boolean; code_sandbox?: string; budget?: { used: number; limit: number | null } } | null }) {
  const nameOf = Object.fromEntries(graphs.map((g) => [g.id, g.name]));
  const totalCost = runs.reduce((a, r) => a + (r.usage?.cost_usd ?? 0), 0);
  return (
    <aside className="space-y-5 lg:sticky lg:top-8 lg:self-start">
      <section id="runs" className="rounded-2xl border border-edge bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Activity size={14} className="text-sky-300" /> Recent runs</h3>
          <span className="text-[11px] text-muted">last {runs.length}</span>
        </div>
        {!runs.length && <p className="text-xs text-muted">No runs yet. Open a graph and press Run.</p>}
        <ul className="space-y-1.5">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/graphs/${r.graph_id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-white/5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${runTone[r.status] ?? "bg-zinc-500"}`} />
                <span className="min-w-0 flex-1 truncate text-fg">{nameOf[r.graph_id] ?? "graph"}</span>
                <span className="shrink-0 text-muted">{r.status}</span>
                <span className="shrink-0 text-muted/70">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
        {runs.length > 0 && <div className="mt-3 border-t border-edge pt-2 text-[11px] text-muted">spent on these runs <b className="text-fg">${totalCost.toFixed(5)}</b></div>}
      </section>

      <section className="rounded-2xl border border-edge bg-panel p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Cpu size={14} className="text-violet-300" /> System</h3>
        <ul className="space-y-1.5 text-xs">
          {[
            ["Groq models", health?.groq, health ? (health.groq ? "connected" : "no key") : "…"],
            ["Gemini", health?.gemini, health ? (health.gemini ? "connected" : "optional") : "…"],
            ["Tracing (Langfuse)", health?.langfuse, health ? (health.langfuse ? "on" : "optional") : "…"],
            ["Code sandbox", health?.code_sandbox === "docker", health?.code_sandbox ?? "…"],
          ].map(([label, ok, text]) => (
            <li key={String(label)} className="flex items-center justify-between">
              <span className="text-muted">{label}</span>
              <span className={`flex items-center gap-1 ${ok ? "text-emerald-300" : "text-muted"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-zinc-600"}`} /> {text}
              </span>
            </li>
          ))}
        </ul>
        {health?.budget && (
          <div className="mt-3 border-t border-edge pt-2">
            <div className="mb-1 flex justify-between text-[11px] text-muted"><span>model calls today</span><span className="text-fg">{health.budget.used}{health.budget.limit ? ` / ${health.budget.limit}` : ""}</span></div>
            {health.budget.limit && <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-violet-400" style={{ width: `${Math.min(100, (health.budget.used / health.budget.limit) * 100)}%` }} /></div>}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-edge bg-gradient-to-br from-sky-500/10 via-panel to-violet-500/10 p-4 text-xs leading-relaxed text-muted">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg"><ShieldCheck size={14} className="text-emerald-300" /> Free-tier friendly</h3>
        Runs cost about <b className="text-fg">$0.00007</b> each on Groq. Evals run 3 rows at a time and sweeps go model by model, so free rate limits hold.
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
    <section className="scroll-mt-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold tracking-tight">Runs across all graphs</h2>
        <select value={filter} onChange={(e) => { setFilter(e.target.value); setPg(0); }} className="rounded-lg border border-edge bg-panel/60 px-2 py-1.5 text-xs text-fg">
          <option value="">all statuses</option>
          {["done", "paused", "running", "error", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="overflow-hidden rounded-2xl border border-edge bg-panel">
        <table className="w-full text-sm">
          <thead className="bg-white/[.02] text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="w-1/2 px-3 py-2.5 text-left font-medium">Graph</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="px-3 py-2.5 text-right font-medium">Time</th>
              <th className="px-3 py-2.5 text-right font-medium">Calls</th>
              <th className="px-3 py-2.5 text-right font-medium">Cost</th>
              <th className="px-3 py-2.5 text-left font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted">No runs yet. Open a graph and press Run.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="group border-t border-edge/70 transition hover:bg-white/[.03]">
                <td className="max-w-0 px-3 py-2">
                  <Link href={`/graphs/${r.graph_id}`} className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg group-hover:text-sky-200">{nameOf[r.graph_id] ?? "deleted graph"}</span>
                    {r.parent_run_id && <span className="shrink-0 text-[10px] text-violet-300">fork</span>}
                    <span className="shrink-0 font-mono text-[10px] text-muted/60">{r.id.slice(0, 8)}</span>
                  </Link>
                </td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 text-xs text-muted"><span className={`h-2 w-2 rounded-full ${runTone[r.status] ?? "bg-zinc-500"}`} /> {r.status}</span></td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "–"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted">{r.usage?.llm_calls ?? 0}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted">${(r.usage?.cost_usd ?? 0).toFixed(6)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted">{new Date(r.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-4 border-t border-edge px-3 py-2 text-xs text-muted">
          <span>{all.length} runs</span>
          <span>total cost <b className="text-fg">${cost.toFixed(5)}</b></span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setPg((p) => Math.max(0, p - 1))} disabled={pg === 0} className="rounded p-1 hover:text-fg disabled:opacity-30"><ChevronLeft size={14} /></button>
            <span className="tabular-nums">{Math.min(pg, pages - 1) + 1} / {pages}</span>
            <button onClick={() => setPg((p) => Math.min(pages - 1, p + 1))} disabled={pg >= pages - 1} className="rounded p-1 hover:text-fg disabled:opacity-30"><ChevronRight size={14} /></button>
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
    <section className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">How it works</h2>
        <p className="mt-1 text-sm text-muted">Four loops, one canvas. Everything below runs on free tiers.</p>
      </div>
      <ol className="grid gap-4 md:grid-cols-2">
        {steps.map(([Icon, title, body], i) => (
          <li key={title} className="rounded-2xl border border-edge bg-panel p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-400/10 text-sky-300"><Icon size={14} /></span><span className="text-muted">{i + 1}.</span> {title}</div>
            <p className="text-[13px] leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-edge bg-panel p-5 text-[13px] text-muted">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg"><Keyboard size={14} /> Shortcuts</div>
          {[["⌘K", "command palette"], ["⌘↵", "run the graph"], ["⌘Z / ⇧⌘Z", "undo / redo"], ["⌫", "delete selection"], ["drag from a handle", "connect nodes"]].map(([k, v]) => (
            <div key={k} className="flex justify-between border-t border-edge/60 py-1.5 first:border-0"><span>{v}</span><kbd className="rounded border border-edge px-1.5 font-mono text-[11px] text-fg">{k}</kbd></div>
          ))}
        </div>
        <div className="rounded-2xl border border-edge bg-panel p-5 text-[13px] leading-relaxed text-muted">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg"><Cpu size={14} /> Under the hood</div>
          Each node completion is a LangGraph checkpoint in Postgres. A run is a pointer to the head of a checkpoint chain plus the events it emitted; forking creates a new checkpoint whose parent is the one you edited. Console, timeline, cost and traces all derive from the same event log.
        </div>
      </div>
    </section>
  );
}

const statusColors: Record<string, string> = { done: "#34d399", error: "#fb7185", paused: "#f472b6", running: "#38bdf8", cancelled: "#fbbf24", queued: "#71717a" };

function Donut({ parts, size = 120 }: { parts: [string, number, string][]; size?: number }) {
  const total = parts.reduce((a, p) => a + p[1], 0) || 1;
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  // precompute arc offsets: no mutation during render
  const arcs = parts.reduce<{ label: string; color: string; len: number; offset: number }[]>((acc, [label, v, color]) => {
    const offset = acc.reduce((a, x) => a + x.len, 0);
    return [...acc, { label, color, len: (v / total) * c, offset }];
  }, []);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.05)" strokeWidth={14} />
      {arcs.map((a) => (
        <circle key={a.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.color} strokeWidth={14} strokeDasharray={`${a.len} ${c - a.len}`} strokeDashoffset={-a.offset} />
      ))}
    </svg>
  );
}

function Bars({ rows, color = "#38bdf8", fmt = (v: number) => String(v) }: { rows: [string, number][]; color?: string; fmt?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return (
    <div className="space-y-1.5">
      {rows.map(([label, v]) => (
        <div key={label} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2 text-[11px]">
          <span className="truncate text-muted" title={label}>{label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: color }} /></div>
          <span className="text-right tabular-nums text-fg">{fmt(v)}</span>
        </div>
      ))}
      {!rows.length && <p className="text-[11px] text-muted">no data yet</p>}
    </div>
  );
}

function Dashboard({ runs, graphs }: { runs: RunInfo[]; graphs: GraphSummary[] }) {
  const nameOf = Object.fromEntries(graphs.map((g) => [g.id, g.name]));
  const byStatus: Record<string, number> = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const done = byStatus.done ?? 0, finished = done + (byStatus.error ?? 0) + (byStatus.cancelled ?? 0);
  const cost = runs.reduce((a, r) => a + (r.usage?.cost_usd ?? 0), 0);
  const calls = runs.reduce((a, r) => a + (r.usage?.llm_calls ?? 0), 0);
  const durations = runs.filter((r) => r.duration_ms != null && r.status === "done").map((r) => r.duration_ms as number).sort((a, b) => a - b);
  const p50 = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const perGraph: Record<string, number> = {};
  for (const r of runs) perGraph[r.graph_id] = (perGraph[r.graph_id] ?? 0) + 1;
  const topGraphs = Object.entries(perGraph).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => [nameOf[id] ?? "deleted graph", n] as [string, number]);
  const costGraph: Record<string, number> = {};
  for (const r of runs) costGraph[r.graph_id] = (costGraph[r.graph_id] ?? 0) + (r.usage?.cost_usd ?? 0);
  const topCost = Object.entries(costGraph).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => [nameOf[id] ?? "deleted graph", v] as [string, number]);
  const byHour: Record<string, number> = {};
  for (const r of runs) { const h = new Date(r.created_at); const k = `${h.getDate()}/${h.getMonth() + 1} ${String(h.getHours()).padStart(2, "0")}h`; byHour[k] = (byHour[k] ?? 0) + 1; }
  const hours = Object.entries(byHour).slice(0, 8).reverse() as [string, number][];
  const kpis: [LucideIcon, string, string, string][] = [
    [LayoutGrid, "Graphs", String(graphs.length), `${graphs.filter((g) => g.issues === 0).length} ready`],
    [Activity, "Runs", String(runs.length), `${byStatus.paused ?? 0} waiting on a human`],
    [ShieldCheck, "Success rate", finished ? `${Math.round((done / finished) * 100)}%` : "–", `${byStatus.error ?? 0} errors`],
    [Coins, "Spend", `$${cost.toFixed(4)}`, `${calls} model calls · p50 ${p50 != null ? (p50 / 1000).toFixed(1) + " s" : "–"}`],
  ];
  return (
    <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(([Icon, label, value, sub]) => (
          <div key={label} className="rounded-2xl border border-edge bg-panel p-4">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted"><Icon size={12} /> {label}</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
            <div className="mt-0.5 text-[11px] text-muted">{sub}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-edge bg-panel p-4">
          <div className="mb-3 text-sm font-semibold">Run outcomes</div>
          <div className="flex items-center gap-4">
            <Donut parts={Object.entries(byStatus).map(([k, v]) => [k, v, statusColors[k] ?? "#71717a"])} />
            <ul className="space-y-1 text-[11px]">
              {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: statusColors[k] ?? "#71717a" }} /><span className="w-16 text-muted">{k}</span><span className="tabular-nums text-fg">{v}</span><span className="text-muted/60">{Math.round((v / (runs.length || 1)) * 100)}%</span></li>
              ))}
              {!runs.length && <li className="text-muted">no runs yet</li>}
            </ul>
          </div>
        </div>
        <div className="rounded-2xl border border-edge bg-panel p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><BarChart3 size={14} className="text-sky-300" /> Runs per graph</div>
          <Bars rows={topGraphs} />
        </div>
        <div className="rounded-2xl border border-edge bg-panel p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Coins size={14} className="text-amber-300" /> Spend per graph</div>
          <Bars rows={topCost} color="#fbbf24" fmt={(v) => `$${v.toFixed(5)}`} />
        </div>
      </div>
      <div className="rounded-2xl border border-edge bg-panel p-4">
        <div className="mb-3 text-sm font-semibold">Activity by hour</div>
        <div className="flex h-24 items-end gap-2">
          {hours.map(([k, v]) => { const max = Math.max(...hours.map((h) => h[1]), 1); return (
            <div key={k} className="flex flex-1 flex-col items-center gap-1" title={`${v} runs`}>
              <div className="w-full rounded-t-md bg-gradient-to-t from-sky-500/40 to-violet-400/60" style={{ height: `${(v / max) * 72}px` }} />
              <span className="text-[9px] text-muted">{k}</span>
            </div>
          ); })}
          {!hours.length && <p className="text-[11px] text-muted">no runs yet</p>}
        </div>
      </div>
    </section>
  );
}
