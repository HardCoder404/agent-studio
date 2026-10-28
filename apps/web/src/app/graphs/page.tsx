"use client";

import { Activity, AlertTriangle, ArrowRight, ArrowUpDown, BarChart3, BookOpen, Coins, CheckSquare, ChevronLeft, ChevronRight, Square as SquareIcon, Bot, Code2, Copy, Cpu, FileJson, Flag, GitFork, HelpCircle, Keyboard, LayoutGrid, Link2, Play, Plus, Search, ShieldCheck, Sparkles, Trash2, TrendingUp, Upload, UserRound, Workflow, Wrench, Zap, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { nodeMeta, type GraphSpec, type GraphSummary, type NodeType, type RunInfo, type TemplateInfo } from "@/lib/types";
import { API_URL } from "@/lib/api";
import { Logo } from "@/components/layout/Logo";
import { useModels } from "@/lib/useCatalog";

const TemplatePreview = dynamic(() => import("@/components/editor/TemplatePreview").then((m) => m.TemplatePreview), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-dim">Loading preview…</div>,
});

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

const runTone: Record<string, string> = { done: "bg-emerald-400", error: "bg-rose-400", paused: "bg-pink-400", running: "bg-sky-400", cancelled: "bg-amber-400", queued: "bg-zinc-500" };
const statusColors: Record<string, string> = { done: "#34d399", error: "#fb7185", paused: "#f472b6", running: "#38bdf8", cancelled: "#fbbf24", queued: "#71717a" };

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

/** How many table rows fit between the card's top edge and the bottom of the viewport. Measured from the
 *  card's position, not its height, so the table's own content cannot feed back into the count. */
function useFitRows(ref: React.RefObject<HTMLElement | null>, row = 42, chrome = 128, min = 5) {
  const [n, setN] = useState(10);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const calc = () => {
      raf = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top + window.scrollY;
        setN(Math.max(min, Math.floor((window.innerHeight - top - 16 - chrome) / row)));
      });
    };
    calc();
    window.addEventListener("resize", calc);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", calc);
    };
  }, [ref, row, chrome, min]);
  return n;
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

function CardHead({ icon: Icon, title, hint, right }: { icon?: LucideIcon; title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold">{Icon && <Icon size={14} className="text-accent" />} {title}</div>
      {right ?? (hint && <span className="text-[11px] text-dim">{hint}</span>)}
    </div>
  );
}

function Pager({ page, pages, setPage, left }: { page: number; pages: number; setPage: (f: (p: number) => number) => void; left?: React.ReactNode }) {
  const cur = Math.min(page, pages - 1);
  return (
    <div className="mt-auto flex items-center gap-3 border-t border-edge bg-panel-2/40 px-3 py-2 text-xs text-muted">
      {left ?? <span>page {cur + 1} of {pages}</span>}
      <div className="ml-auto flex items-center gap-1">
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={cur === 0} className="icon-btn"><ChevronLeft size={14} /></button>
        <span className="tabular-nums">{cur + 1} / {pages}</span>
        <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={cur >= pages - 1} className="icon-btn"><ChevronRight size={14} /></button>
      </div>
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
  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const g = await api.createGraph({ name: data.name ?? file.name.replace(/\.json$/, ""), description: data.description, nodes: data.nodes ?? [], edges: data.edges ?? [] });
      router.push(`/graphs/${g.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `could not import: ${String(e)}`);
    }
  };
  const onImport = () => fileRef.current?.click();

  return (
    <main className="relative min-h-full overflow-x-hidden">
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      <AppBar view={view} setView={setView} health={health} onImport={onImport} onNew={create} />

      <div className="mx-auto grid w-full max-w-[1680px] min-h-[calc(100vh-3.5rem)] gap-4 px-4 py-4 md:px-6 lg:grid-cols-[minmax(0,1fr)_19rem] 2xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
          {view === "overview" && <Overview runs={runs} graphs={graphs} templates={templates} fromTemplate={fromTemplate} setView={setView} onNew={create} />}
          {view === "graphs" && <GraphsView graphs={graphs} refresh={refresh} onNew={create} />}
          {view === "templates" && <TemplatesView templates={templates} fromTemplate={fromTemplate} onImport={onImport} onNew={create} />}
          {view === "runs" && <RunsView runs={runs} graphs={graphs ?? []} />}
          {view === "guide" && <Guide />}
        </div>
        <RightRail runs={runs.slice(0, 5)} paused={runs.filter((r) => r.status === "paused").slice(0, 5)} graphs={graphs ?? []} health={health} />
      </div>
    </main>
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

/* ---------------- right rail (every view) ---------------- */

function RightRail({ runs, paused, graphs, health }: { runs: RunInfo[]; paused: RunInfo[]; graphs: GraphSummary[]; health: Health }) {
  const nameOf = Object.fromEntries(graphs.map((g) => [g.id, g.name]));
  const totalCost = runs.reduce((a, r) => a + (r.usage?.cost_usd ?? 0), 0);
  return (
    <aside className="flex min-w-0 flex-col gap-4">
      <section className="card p-4">
        <CardHead icon={Activity} title="Recent runs" hint={`last ${runs.length}`} />
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
        <CardHead icon={UserRound} title="Needs attention" right={paused.length > 0 ? <span className="pill bg-pink-400/10 text-pink-300">{paused.length} paused</span> : undefined} />
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

      <ModelsCard />

      <section className="card relative overflow-hidden p-4 text-xs leading-relaxed text-muted">
        <div aria-hidden className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-accent/15 blur-2xl" />
        <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg"><ShieldCheck size={14} className="text-accent" /> Free-tier friendly</h3>
        Runs cost about <b className="font-mono text-fg">$0.00007</b> each on Groq. Evals run 3 rows at a time and sweeps go model by model, so free rate limits hold.
      </section>

      <section className="card flex flex-1 flex-col p-4">
        <CardHead icon={Cpu} title="System" />
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
        <div className="mt-auto space-y-2 pt-3">
          <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
            {[["⌘K", "commands"], ["⌘↵", "run"], ["⌘Z", "undo"], ["⌫", "delete"]].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded-md border border-edge bg-panel-2/60 px-2 py-1 text-muted"><span>{v}</span><kbd className="kbd">{k}</kbd></div>
            ))}
          </div>
          {health?.budget && (
            <div className="border-t border-edge pt-2.5">
              <div className="mb-1.5 flex justify-between text-[11px] text-muted"><span>model calls today</span><span className="font-mono text-fg">{health.budget.used}{health.budget.limit ? ` / ${health.budget.limit}` : ""}</span></div>
              {health.budget.limit && <div className="h-1.5 overflow-hidden rounded-full bg-panel-3"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, Math.min(100, (health.budget.used / health.budget.limit) * 100))}%` }} /></div>}
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}

const tierTone: Record<string, string> = { small: "bg-emerald-400/10 text-emerald-300", medium: "bg-sky-400/10 text-sky-300", large: "bg-violet-400/10 text-violet-300" };

function ModelsCard() {
  const models = useModels();
  const shown = models.filter((m) => m.available).slice(0, 6);
  return (
    <section className="card p-4">
      <CardHead icon={Bot} title="Models" hint={models.length ? `${models.filter((m) => m.available).length} available` : undefined} />
      {!shown.length && <p className="text-xs text-muted">No model keys configured. Add a Groq or Gemini key to the API.</p>}
      <ul className="-mx-2 space-y-0.5">
        {shown.map((m) => (
          <li key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg" title={m.id}>{m.id.split("/").slice(1).join("/")}</span>
            <span className={`pill ${tierTone[m.tier] ?? "bg-panel-3 text-muted"}`}>{m.tier}</span>
            <span className="shrink-0 whitespace-nowrap text-right font-mono text-[10.5px] text-dim" title="input / output price per million tokens">${m.input_per_m}/{m.output_per_m}</span>
          </li>
        ))}
      </ul>
      {shown.length > 0 && <div className="mt-2.5 border-t border-edge pt-2 text-[10.5px] text-dim">prices per million tokens, input / output</div>}
    </section>
  );
}

/* ---------------- overview ---------------- */

function Overview({ runs, graphs: graphsOrNull, templates, fromTemplate, setView, onNew }: { runs: RunInfo[]; graphs: GraphSummary[] | null; templates: TemplateInfo[]; fromTemplate: (slug: string) => void; setView: (v: View) => void; onNew: () => void }) {
  const graphs = graphsOrNull ?? [];
  const healthy = graphs.filter((g) => g.issues === 0).length;
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
  // "now" is only known after mount: using the clock during server render would break hydration
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);
  // last 7 days in 4-hour buckets, aligned to local midnight six days ago
  const BUCKET = 4 * 3600000, N = 42;
  const dayStart = now != null ? new Date(now) : null;
  dayStart?.setHours(0, 0, 0, 0);
  const seriesStart = dayStart ? dayStart.getTime() - 6 * 86400000 : 0;
  const series = Array.from({ length: N }, (_, i) => ({ t: seriesStart + i * BUCKET, runs: 0, cost: 0 }));
  if (dayStart) {
    for (const r of runs) {
      const i = Math.floor((new Date(r.created_at).getTime() - seriesStart) / BUCKET);
      if (i >= 0 && i < N) { series[i].runs += 1; series[i].cost += r.usage?.cost_usd ?? 0; }
    }
  }
  const runs7 = series.reduce((a, b) => a + b.runs, 0);
  const cost7 = series.reduce((a, b) => a + b.cost, 0);
  const kpis: [LucideIcon, string, string, string][] = [
    [LayoutGrid, "Graphs", String(graphs.length), `${healthy} ready`],
    [Activity, "Runs", String(runs.length), `${byStatus.paused ?? 0} waiting on a human`],
    [ShieldCheck, "Success rate", finished ? `${Math.round((done / finished) * 100)}%` : "–", `${byStatus.error ?? 0} errors`],
    [Coins, "Spend", `$${cost.toFixed(4)}`, `${calls} model calls · p50 ${p50 != null ? (p50 / 1000).toFixed(1) + " s" : "–"}`],
  ];
  return (
    <>
      <section className="card relative overflow-hidden">
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(80%_120%_at_15%_0%,black,transparent)]" />
        <div aria-hidden className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-32 h-80 w-80 rounded-full bg-sky-400/8 blur-3xl" />
        <div className="relative grid gap-6 p-6 md:p-7 xl:grid-cols-[1.15fr_1fr]">
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase"><Logo size="sm" /> Agent Studio</span>
              <span className="pill border border-accent/30 bg-accent/10 text-accent"><Zap size={11} /> Time-travel debugging</span>
              <span className="pill border border-edge-2 bg-panel-2 text-muted">LangGraph · Postgres · MCP</span>
            </div>
            <h1 className="mt-5 text-[36px] leading-[1.02] font-semibold tracking-[-0.03em] md:text-[46px]">
              Build agents on a canvas.
              <br />
              Run, <span className="text-accent">rewind</span>, fork.
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted">
              Compose multi-agent workflows visually, watch tokens stream through every node, then scrub back to any checkpoint, edit the state and fork a new run from that step. Evals, model sweeps and MCP tools are built in.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button onClick={onNew} className="btn btn-primary"><Plus size={15} strokeWidth={2.5} /> New graph</button>
              <button onClick={() => setView("templates")} className="btn btn-ghost"><Sparkles size={14} className="text-accent" /> Browse templates</button>
              <span className="ml-1 hidden items-center gap-1.5 text-[11px] text-dim sm:flex"><kbd className="kbd">⌘K</kbd> commands · <kbd className="kbd">⌘↵</kbd> run</span>
            </div>
            <HeroFlow />
          </div>
          <div className="card-2 flex min-w-0 flex-col p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold"><TrendingUp size={14} className="text-accent" /> Runs, last 7 days</div>
              <span className="font-mono text-[11px] text-dim">{runs7} runs · ${cost7.toFixed(5)}</span>
            </div>
            {dayStart ? <RunsLine series={series} /> : <div className="mt-3 min-h-[150px] flex-1 animate-pulse rounded-lg bg-panel-3/40" />}
            <div className="mt-3 grid grid-cols-3 divide-x divide-edge-2 border-t border-edge-2 pt-3 text-xs">
              {[
                ["graphs", graphsOrNull ? graphs.length : "–", ""],
                ["ready to run", graphsOrNull ? healthy : "–", "text-emerald-300"],
                ["templates", templates.length, ""],
              ].map(([label, value, cls], i) => (
                <div key={String(label)} className={i ? "px-3" : "pr-3"}>
                  <div className={`text-lg font-semibold tabular-nums leading-none ${cls}`}>{value}</div>
                  <div className="mt-1 text-[10.5px] text-dim">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

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
        <div className="card flex flex-col p-4">
          <CardHead icon={BarChart3} title="Runs per graph" hint="top 5" />
          <Bars rows={topGraphs} />
          <div className="mt-auto flex justify-between border-t border-edge pt-2.5 text-[11px] text-muted"><span>graphs with runs</span><b className="font-mono text-fg">{graphsWithRuns} / {graphs.length}</b></div>
        </div>
        <div className="card flex flex-col p-4">
          <CardHead icon={Coins} title="Spend per graph" hint="USD" />
          <Bars rows={topCost} color="#fbbf24" fmt={(v) => `$${v.toFixed(5)}`} />
          <div className="mt-auto flex justify-between border-t border-edge pt-2.5 text-[11px] text-muted"><span>average per run</span><b className="font-mono text-fg">${runs.length ? (cost / runs.length).toFixed(6) : "0"}</b></div>
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
    </>
  );
}

/* ---------------- graphs ---------------- */

function GraphsView({ graphs, refresh, onNew }: { graphs: GraphSummary[] | null; refresh: () => void; onNew: () => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"updated" | "name" | "nodes" | "issues">("updated");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [onlyReady, setOnlyReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const PAGE = useFitRows(cardRef, 47, 136);

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
  const cur = Math.min(page, pages - 1);
  const pageRows = shown.slice(cur * PAGE, cur * PAGE + PAGE);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const duplicate = async (id: string) => { await api.duplicateGraph(id); refresh(); };
  const remove = async (id: string) => { await api.deleteGraph(id); refresh(); };
  const removeMany = async () => {
    await Promise.all([...sel].map((id) => api.deleteGraph(id)));
    setSel(new Set());
    refresh();
  };
  const all = graphs ?? [];
  const ready = all.filter((g) => g.issues === 0).length;
  const shared = all.filter((g) => g.shared).length;
  const nodesTotal = all.reduce((a, g) => a + g.nodes, 0);

  return (
    <>
      <div className="card grid grid-cols-2 divide-y divide-edge md:grid-cols-4 md:divide-x md:divide-y-0">
        {([
          [Workflow, "Graphs", String(all.length), `${nodesTotal} nodes in total`],
          [ShieldCheck, "Ready to run", String(ready), `${all.length - ready} with issues`],
          [Link2, "Shared", String(shared), "read-only links"],
          [Sparkles, "Showing", String(shown.length), q ? `matching “${q}”` : onlyReady ? "ready only" : "all graphs"],
        ] as [LucideIcon, string, string, string][]).map(([Icon, label, value, sub]) => (
          <div key={label} className="p-3.5">
            <div className="eyebrow flex items-center gap-1.5"><Icon size={12} className="text-accent" /> {label}</div>
            <div className="mt-1.5 text-[22px] font-semibold tabular-nums leading-none tracking-tight">{value}</div>
            <div className="mt-1 text-[11px] text-muted">{sub}</div>
          </div>
        ))}
      </div>

      <div ref={cardRef} className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
          <h2 className="mr-auto text-[13px] font-semibold tracking-tight">Your graphs</h2>
          <label className="input flex w-52 items-center gap-2 py-0 pr-2 text-xs text-muted">
            <Search size={13} className="shrink-0" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search graphs" className="h-7 w-full bg-transparent text-fg outline-none placeholder:text-dim" />
          </label>
          <button onClick={() => { setOnlyReady((v) => !v); setPage(0); }} className={`btn btn-sm ${onlyReady ? "border border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "btn-ghost"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${onlyReady ? "bg-emerald-400" : "bg-dim"}`} /> ready only
          </button>
          <button onClick={onNew} className="btn btn-sm btn-primary"><Plus size={14} /> New</button>
        </div>
        {graphs && graphs.length === 0 && <div className="p-10 text-center text-sm text-muted">No graphs yet. Pick a template or create a blank one.</div>}
        {graphs && graphs.length > 0 && shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{q}”.</p>}
        <table className="w-full text-sm">
          <thead className="bg-panel-2/60">
            <tr className="eyebrow">
              <th className="w-10 px-3 py-2.5">
                <button onClick={() => setSel(sel.size === pageRows.length ? new Set() : new Set(pageRows.map((g) => g.id)))} className="text-dim hover:text-fg" title="Select page">
                  {sel.size > 0 && sel.size === pageRows.length ? <CheckSquare size={14} /> : <SquareIcon size={14} />}
                </button>
              </th>
              {([
                ["name", "Name", "text-left"],
                ["nodes", "Nodes", "text-right"],
                ["issues", "Status", "text-left"],
                ["updated", "Updated", "text-left"],
              ] as const).map(([key, label, align]) => (
                <th key={key} className={`px-3 py-2.5 ${align} ${key === "name" ? "" : "w-0 whitespace-nowrap"}`}>
                  <button onClick={() => setSort(key)} className={`eyebrow inline-flex items-center gap-1 hover:text-fg ${sort === key ? "text-fg" : ""}`}>
                    {label} <ArrowUpDown size={11} className={sort === key ? "opacity-100" : "opacity-30"} />
                  </button>
                </th>
              ))}
              <th className="w-0 px-3 py-2.5 text-right">v</th>
              <th className="w-24 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((g) => (
              <tr key={g.id} className={`group border-t border-edge transition hover:bg-panel-2/70 ${sel.has(g.id) ? "bg-accent/5" : ""}`}>
                <td className="px-3 py-2">
                  <button onClick={() => toggle(g.id)} className={sel.has(g.id) ? "text-accent" : "text-dim hover:text-fg"}>
                    {sel.has(g.id) ? <CheckSquare size={14} /> : <SquareIcon size={14} />}
                  </button>
                </td>
                <td className="max-w-0 px-3 py-2">
                  <Link href={`/graphs/${g.id}`} className="flex items-center gap-2.5">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-panel-3 text-muted ring-1 ring-edge-2 transition group-hover:bg-accent/15 group-hover:text-accent group-hover:ring-accent/30"><Workflow size={12} /></span>
                    <span className="truncate text-[13px] font-medium text-fg" title={g.name}>{g.name}</span>
                    {g.shared && <Link2 size={12} className="shrink-0 text-accent" aria-label="shared with a link" />}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono text-[12px] text-muted">{g.nodes}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {g.issues > 0 ? (
                    <span className="pill bg-amber-400/10 text-amber-300"><AlertTriangle size={10} /> {g.issues} issue{g.issues > 1 ? "s" : ""}</span>
                  ) : (
                    <span className="pill bg-emerald-400/10 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> ready</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted" title={new Date(g.updated_at).toLocaleString()}>{ago(g.updated_at)}</td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-dim">v{g.version}</td>
                <td className="px-3 py-2">
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
        <Pager
          page={page}
          pages={pages}
          setPage={setPage}
          left={sel.size > 0 ? (
            <>
              <span className="text-fg">{sel.size} selected</span>
              <button onClick={removeMany} className="btn btn-sm btn-danger"><Trash2 size={12} /> Delete selected</button>
              <button onClick={() => setSel(new Set())} className="hover:text-fg">clear</button>
            </>
          ) : (
            <span>{shown.length} graph{shown.length === 1 ? "" : "s"} · {PAGE} per page</span>
          )}
        />
      </div>
    </>
  );
}

/* ---------------- runs ---------------- */

function RunsView({ runs, graphs }: { runs: RunInfo[]; graphs: GraphSummary[] }) {
  const nameOf = Object.fromEntries(graphs.map((g) => [g.id, g.name]));
  const [filter, setFilter] = useState<string>("");
  const [pg, setPg] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const PAGE = useFitRows(cardRef, 37, 136);
  const all = runs.filter((r) => !filter || r.status === filter);
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const cur = Math.min(pg, pages - 1);
  const rows = all.slice(cur * PAGE, cur * PAGE + PAGE);
  const cost = all.reduce((a, r) => a + (r.usage?.cost_usd ?? 0), 0);
  const calls = all.reduce((a, r) => a + (r.usage?.llm_calls ?? 0), 0);
  const byStatus: Record<string, number> = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const durations = all.filter((r) => r.duration_ms != null).map((r) => r.duration_ms as number).sort((a, b) => a - b);
  const p50 = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const forks = all.filter((r) => r.parent_run_id).length;

  return (
    <>
      <div className="card grid grid-cols-2 divide-y divide-edge md:grid-cols-4 md:divide-x md:divide-y-0">
        {([
          [Activity, "Runs", String(all.length), `${forks} fork${forks === 1 ? "" : "s"}`],
          [ShieldCheck, "Done", String(byStatus.done ?? 0), `${byStatus.error ?? 0} errors · ${byStatus.cancelled ?? 0} cancelled`],
          [UserRound, "Paused", String(byStatus.paused ?? 0), "waiting on a human"],
          [Coins, "Cost", `$${cost.toFixed(5)}`, `${calls} model calls · p50 ${p50 != null ? (p50 / 1000).toFixed(1) + " s" : "–"}`],
        ] as [LucideIcon, string, string, string][]).map(([Icon, label, value, sub]) => (
          <div key={label} className="p-3.5">
            <div className="eyebrow flex items-center gap-1.5"><Icon size={12} className="text-accent" /> {label}</div>
            <div className="mt-1.5 text-[22px] font-semibold tabular-nums leading-none tracking-tight">{value}</div>
            <div className="mt-1 text-[11px] text-muted">{sub}</div>
          </div>
        ))}
      </div>

      <div ref={cardRef} className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
          <h2 className="mr-auto text-[13px] font-semibold tracking-tight">Runs across all graphs</h2>
          <div className="flex items-center gap-0.5 rounded-lg border border-edge-2 bg-panel-2 p-0.5 text-xs">
            {["", "done", "paused", "running", "error", "cancelled"].map((s) => (
              <button key={s} onClick={() => { setFilter(s); setPg(0); }} className={`rounded-md px-2 py-1 capitalize transition ${filter === s ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`}>{s || "all"}{s && byStatus[s] ? <span className="ml-1 font-mono text-[10px] text-dim">{byStatus[s]}</span> : null}</button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-panel-2/60">
            <tr className="eyebrow">
              <th className="px-3 py-2.5 text-left">Graph</th>
              <th className="w-0 whitespace-nowrap px-3 py-2.5 text-left">Status</th>
              <th className="w-0 whitespace-nowrap px-3 py-2.5 text-right">Time</th>
              <th className="w-0 whitespace-nowrap px-3 py-2.5 text-right">Calls</th>
              <th className="w-0 whitespace-nowrap px-3 py-2.5 text-right">Cost</th>
              <th className="w-0 whitespace-nowrap px-3 py-2.5 text-left">Started</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted">No runs yet. Open a graph and press Run.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="group border-t border-edge transition hover:bg-panel-2/70">
                <td className="max-w-0 px-3 py-2">
                  <Link href={`/graphs/${r.graph_id}`} className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-fg">{nameOf[r.graph_id] ?? "deleted graph"}</span>
                    {r.parent_run_id && <span className="pill bg-violet-400/10 text-violet-300">fork</span>}
                    <span className="shrink-0 font-mono text-[10px] text-dim">{r.id.slice(0, 8)}</span>
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap"><span className="inline-flex items-center gap-1.5 text-xs text-muted"><span className={`h-2 w-2 rounded-full ${runTone[r.status] ?? "bg-zinc-500"}`} /> {r.status}</span></td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[11px] text-muted">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "–"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[11px] text-muted">{r.usage?.llm_calls ?? 0}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[11px] text-muted">${(r.usage?.cost_usd ?? 0).toFixed(6)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted" title={new Date(r.created_at).toLocaleString()}>{ago(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager page={pg} pages={pages} setPage={setPg} left={<span>{all.length} runs · total cost <b className="font-mono text-fg">${cost.toFixed(5)}</b></span>} />
      </div>
    </>
  );
}

/* ---------------- templates ---------------- */

function TemplatesView({ templates, fromTemplate, onImport, onNew }: { templates: TemplateInfo[]; fromTemplate: (slug: string) => void; onImport: () => void; onNew: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const current = templates.find((t) => t.id === picked) ?? templates[0];
  const [spec, setSpec] = useState<GraphSpec | null>(null);
  const slug = current?.id;
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    api.getTemplate(slug).then((sp) => alive && setSpec(sp)).catch(() => alive && setSpec(null));
    return () => {
      alive = false;
    };
  }, [slug]);
  const shownSpec = spec && spec.id === slug ? spec : null;
  const has = (t: TemplateInfo, k: NodeType) => t.node_types.includes(k);
  const cols: NodeType[] = ["llm", "router", "human", "tool", "code"];
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {templates.map((t) => {
          const Icon = templateIcon[t.id] ?? Workflow;
          const active = current?.id === t.id;
          return (
            <button key={t.id} onClick={() => setPicked(t.id)} onDoubleClick={() => fromTemplate(t.id)} className={`card group relative flex gap-3 p-3.5 text-left transition ${active ? "border-accent/60 shadow-[0_0_0_3px_rgb(197_241_53/0.12)]" : "hover:border-edge-2 hover:bg-panel-2/40"}`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 transition ${active ? "bg-accent text-accent-ink ring-accent/40" : "bg-accent/10 text-accent ring-accent/20"}`}>
                <Icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13.5px] font-semibold tracking-tight">{t.name}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-dim">{t.nodes} nodes</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-relaxed text-muted">{t.description}</span>
              </span>
            </button>
          );
        })}
        {!templates.length && <div className="card p-8 text-center text-sm text-muted md:col-span-2 2xl:col-span-4">No templates available.</div>}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <div className="card flex min-h-[26rem] min-w-0 flex-col overflow-hidden">
          {current ? (
            <>
              <div className="flex items-center gap-3 border-b border-edge px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{current.name}</div>
                  <div className="truncate text-[11px] text-muted">{current.description}</div>
                </div>
                <TypeChips types={current.node_types} />
                <button onClick={() => fromTemplate(current.id)} className="btn btn-sm btn-primary"><Plus size={13} strokeWidth={2.5} /> Use template</button>
              </div>
              <div className="relative min-h-0 flex-1">
                {shownSpec ? <TemplatePreview spec={shownSpec} /> : <div className="grid h-full place-items-center text-xs text-dim">Loading preview…</div>}
                <span className="pointer-events-none absolute right-3 bottom-2 text-[10px] text-dim">read-only preview · double-click a card to create</span>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-sm text-muted">Pick a template to preview it.</div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="card min-w-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
              <div className="flex items-center gap-1.5 text-sm font-semibold"><LayoutGrid size={14} className="text-accent" /> What each template uses</div>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-panel-2/60">
                <tr className="eyebrow">
                  <th className="px-4 py-2 text-left">Template</th>
                  {cols.map((k) => <th key={k} className="w-0 whitespace-nowrap px-2.5 py-2 text-center">{typeMeta[k].label}</th>)}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} onClick={() => setPicked(t.id)} className={`cursor-pointer border-t border-edge transition hover:bg-panel-2/70 ${current?.id === t.id ? "bg-accent/5" : ""}`}>
                    <td className="max-w-0 px-4 py-2"><span className="block truncate font-medium text-fg">{t.name}</span></td>
                    {cols.map((k) => {
                      const I = typeMeta[k].icon;
                      return <td key={k} className="px-2.5 py-2 text-center">{has(t, k) ? <span className={`inline-grid h-5 w-5 place-items-center rounded-md ${typeMeta[k].cls}`}><I size={11} /></span> : <span className="text-dim">–</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <button onClick={onNew} className="card group flex items-center gap-3 p-3.5 text-left transition hover:border-accent/40">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel-3 text-muted ring-1 ring-edge-2 transition group-hover:bg-accent group-hover:text-accent-ink"><Plus size={16} /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">Blank graph</span>
                <span className="block truncate text-[11px] text-muted">Start and End only</span>
              </span>
            </button>
            <button onClick={onImport} className="card group flex items-center gap-3 p-3.5 text-left transition hover:border-accent/40">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel-3 text-muted ring-1 ring-edge-2 transition group-hover:bg-accent group-hover:text-accent-ink"><FileJson size={16} /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">Import JSON</span>
                <span className="block truncate text-[11px] text-muted">Exported from the editor</span>
              </span>
            </button>
          </div>
          <div className="card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
              <div className="flex items-center gap-1.5 text-sm font-semibold"><Workflow size={14} className="text-accent" /> Nodes in {current?.name ?? "this template"}</div>
              <span className="text-[11px] text-dim">{shownSpec ? `${shownSpec.nodes.length} nodes · ${shownSpec.edges.length} edges` : ""}</span>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-edge overflow-y-auto">
              {(shownSpec?.nodes ?? []).map((n) => {
                const m = typeMeta[n.type as NodeType];
                const c = n.config as Record<string, unknown>;
                const detail = String(c.model ?? c.tool ?? c.question ?? (c.prompt ? String(c.prompt).replace(/\s+/g, " ") : "") ?? "");
                return (
                  <li key={n.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${m.cls}`}><m.icon size={13} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="truncate font-medium text-fg">{n.label}</span><span className="shrink-0 font-mono text-[10px] text-dim">{m.label}</span></span>
                      {detail && <span className="block truncate font-mono text-[10.5px] text-muted">{detail}</span>}
                    </span>
                  </li>
                );
              })}
              {!shownSpec && <li className="px-4 py-3 text-xs text-dim">Loading…</li>}
            </ul>
            <div className="border-t border-edge px-4 py-2 text-[10.5px] leading-relaxed text-dim">Creating from a template copies it into your graphs; the original is never changed.</div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------------- guide ---------------- */

function Guide() {
  const steps: [LucideIcon, string, string][] = [
    [LayoutGrid, "Compose", "Drag nodes onto the canvas: model, tool, router, human gate, code. Prompts reference variables as {{name}}; the inspector shows what is in scope."],
    [Play, "Run", "Press ⌘↵. Tokens stream inside the node that generates them, edges light up as data flows, and human nodes pause the run with a card showing exactly what to approve."],
    [Activity, "Time-travel", "Open the State tab: scrub through every checkpoint, see what each step changed, edit a variable and fork a new run from that step. Compare the two side by side."],
    [ShieldCheck, "Eval and ship", "Build a dataset, pick scorers, run an eval; failures light up the node that caused them. Sweep candidate models for a node and apply the cheapest one that still passes."],
  ];
  const order: NodeType[] = ["start", "llm", "tool", "router", "human", "code", "end"];
  return (
    <>
      <ol className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {steps.map(([Icon, title, body], i) => (
          <li key={title} className="card relative p-4">
            <span className="absolute top-3.5 right-4 font-mono text-[11px] text-dim">0{i + 1}</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20"><Icon size={15} /></span>
            <div className="mt-2.5 text-sm font-semibold">{title}</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 xl:grid-cols-[2fr_3fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="card p-4 text-[12.5px] text-muted">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg"><Keyboard size={14} className="text-accent" /> Shortcuts</div>
            {[["⌘K", "command palette"], ["⌘↵", "run the graph"], ["⌘Z / ⇧⌘Z", "undo / redo"], ["⌫", "delete selection"], ["drag from a port", "connect nodes"]].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-t border-edge py-1.5 first:border-0"><span>{v}</span><kbd className="kbd">{k}</kbd></div>
            ))}
          </div>
          <div className="card p-4 text-[12.5px] leading-relaxed text-muted">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg"><Cpu size={14} className="text-accent" /> Under the hood</div>
            Each node completion is a LangGraph checkpoint in Postgres. A run is a pointer to the head of a checkpoint chain plus the events it emitted; forking creates a new checkpoint whose parent is the one you edited. Console, timeline, cost and traces all derive from the same event log.
          </div>
        </div>
        <div className="card min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold"><Workflow size={14} className="text-accent" /> Node types</div>
            <span className="text-[11px] text-dim">what each block on the canvas does</span>
          </div>
          <ul className="divide-y divide-edge">
            {order.map((k) => {
              const m = typeMeta[k];
              return (
                <li key={k} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${m.cls}`}><m.icon size={14} /></span>
                  <span className="w-16 shrink-0 font-medium text-fg">{nodeMeta[k].title}</span>
                  <span className="min-w-0 flex-1 text-muted">{nodeMeta[k].hint}</span>
                  <span className="hidden font-mono text-[10.5px] text-dim lg:inline">{guideNotes[k]}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="grid flex-1 gap-4 xl:grid-cols-[2fr_3fr]">
        <div className="card min-w-0 p-4">
          <CardHead icon={BookOpen} title="Glossary" />
          <dl className="divide-y divide-edge text-[12px]">
            {glossary.map(([term, def]) => (
              <div key={term} className="flex gap-3 py-2 first:pt-0 last:pb-0">
                <dt className="w-24 shrink-0 font-medium text-fg">{term}</dt>
                <dd className="min-w-0 text-muted">{def}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="card min-w-0 p-4">
          <CardHead icon={HelpCircle} title="Common questions" />
          <div className="grid gap-x-6 gap-y-3 text-[12px] md:grid-cols-2">
            {faq.map(([q, a]) => (
              <div key={q}>
                <div className="font-medium text-fg">{q}</div>
                <p className="mt-0.5 leading-relaxed text-muted">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

const glossary: [string, string][] = [
  ["Graph", "A workflow: nodes connected by edges, saved with a version number on every edit."],
  ["Run", "One execution of a graph with a given input. Streams events live and keeps them for replay."],
  ["Checkpoint", "The full state after a node finishes. Every run is a chain of checkpoints."],
  ["Fork", "A new run that starts from an edited checkpoint of another run. The original stays untouched."],
  ["Eval", "A dataset of inputs plus scorers; each row runs the graph and gets a pass or fail."],
  ["Sweep", "The same eval repeated with different models on one node, to find the cheapest that passes."],
  ["MCP", "Model Context Protocol. Connect a server and its tools appear in the Tool node."],
];

const faq: [string, string][] = [
  ["Does a fork change the original run?", "No. It creates a new checkpoint whose parent is the one you edited, and a new run with its own head."],
  ["Why do tokens disappear after a run?", "Live tokens are only streamed; the finished text is stored once in the node_end event, so replays stay small."],
  ["What does the amber heatmap mean?", "After an eval, each node glows by the share of failed rows that it wrote the scored variable for."],
  ["Is the code node safe?", "Code runs in a Docker container with no network, a read-only filesystem and a timeout; a subprocess is the fallback."],
  ["What happens on rate limits?", "Model calls retry with backoff and show a retry chip on the node. Evals run three rows at a time."],
  ["Can someone else edit my shared graph?", "No. A share link is read-only; viewers can copy the graph into their own workspace."],
  ["Which models can I use?", "Anything in the Models list: Groq's open-weight models by default, Gemini when a key is set. Each node picks its own model."],
  ["Where do runs and their events live?", "In Postgres, next to the graph. Console, timeline, cost and traces all read the same event log, so nothing is recomputed."],
];

const guideNotes: Record<NodeType, string> = {
  start: "input → vars",
  llm: "prompt · model · output_key",
  tool: "tool · args · output_key",
  router: "rule | model · branches",
  human: "question · show_keys",
  code: "python · sandboxed",
  end: "final vars",
};

/* ---------------- hero visuals ---------------- */

/** A tiny animated workflow: the product in one glance. */
function HeroFlow() {
  const nodes: [number, string, string][] = [
    [0, "Start", "#34d399"],
    [1, "Model", "#38bdf8"],
    [2, "Human", "#f472b6"],
    [3, "Router", "#a78bfa"],
    [4, "End", "#fb7185"],
  ];
  const x = (i: number) => 12 + i * 122;
  return (
    <svg viewBox="0 0 520 78" className="mt-auto h-[72px] w-full max-w-[520px] pt-4 text-fg" aria-hidden>
      <defs>
        <marker id="hf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="#3a3a44" />
        </marker>
      </defs>
      {/* straight edges */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <path d={`M${x(i) + 92} 48 H${x(i + 1) - 2}`} stroke="#3a3a44" strokeWidth="1.5" fill="none" markerEnd="url(#hf-arrow)" />
          <path d={`M${x(i) + 92} 48 H${x(i + 1) - 2}`} stroke="var(--accent)" strokeWidth="1.5" fill="none" className="flow-dash" />
        </g>
      ))}
      {/* feedback edge: router → model */}
      <path d={`M${x(3) + 46} 34 C ${x(3) + 46} 8, ${x(1) + 46} 8, ${x(1) + 46} 32`} stroke="#3a3a44" strokeWidth="1.5" fill="none" markerEnd="url(#hf-arrow)" />
      <path d={`M${x(3) + 46} 34 C ${x(3) + 46} 8, ${x(1) + 46} 8, ${x(1) + 46} 32`} stroke="#a78bfa" strokeWidth="1.5" fill="none" className="flow-dash" style={{ animationDuration: "1.8s" }} />
      <text x={x(2) + 46} y="16" textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="#6b6b78">changes requested</text>
      {nodes.map(([i, label, color]) => (
        <g key={label} transform={`translate(${x(i)} 34)`}>
          <rect width="92" height="28" rx="8" fill="var(--panel)" stroke="var(--edge-2)" />
          <rect x="0.5" y="0.5" width="91" height="27" rx="7.5" fill="none" stroke={color} strokeOpacity="0.35" />
          <circle cx="14" cy="14" r="3.5" fill={color} />
          <text x="26" y="18" fontSize="11" fontWeight="600" fill="currentColor">{label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Lime area line chart with hover readout. Paths scale to the box; the stroke stays 2px. */
function RunsLine({ series }: { series: { t: number; runs: number; cost: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 150, PAD = 6;
  const max = Math.max(1, ...series.map((p) => p.runs));
  const n = series.length;
  const px = (i: number) => (i / (n - 1)) * W;
  const py = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  // smooth curve through the points (Catmull-Rom → cubic bezier)
  const pts = series.map((p, i) => [px(i), py(p.runs)] as [number, number]);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  const area = `${d} L${W} ${H} L0 ${H} Z`;
  const days = series.map((p, i) => [i, new Date(p.t)] as const).filter(([, dt]) => dt.getHours() === 0);
  const h = hover != null ? series[hover] : null;
  const fmtT = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "2-digit" });
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      <div
        className="relative min-h-[140px] w-full flex-1"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="rl-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={py(max * f)} y2={py(max * f)} stroke="var(--edge)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill="url(#rl-fill)" />
          <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {h && (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-accent/50" style={{ left: `${(hover! / (n - 1)) * 100}%` }} />
            <div className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-canvas" style={{ left: `${(hover! / (n - 1)) * 100}%`, top: `${(py(h.runs) / H) * 100}%` }} />
            <div className={`pointer-events-none absolute top-1 rounded-lg border border-edge-2 bg-panel px-2 py-1 text-[10.5px] shadow-lg ${hover! > n / 2 ? "-translate-x-full" : ""}`} style={{ left: `${(hover! / (n - 1)) * 100}%`, marginLeft: hover! > n / 2 ? -8 : 8 }}>
              <div className="text-muted">{fmtT(h.t)}</div>
              <div className="font-mono text-fg">{h.runs} run{h.runs === 1 ? "" : "s"} · ${h.cost.toFixed(5)}</div>
            </div>
          </>
        )}
        <span className="pointer-events-none absolute top-0 right-0 font-mono text-[9.5px] text-dim">max {max}</span>
      </div>
      <div className="relative mt-1 h-4 font-mono text-[9.5px] text-dim">
        {days.map(([i, dt]) => (
          <span key={i} className="absolute -translate-x-1/2" style={{ left: `${(i / (n - 1)) * 100}%` }}>{dt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        ))}
      </div>
    </div>
  );
}

/* ---------------- charts ---------------- */

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
