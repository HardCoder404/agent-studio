"use client";

import { Activity, AlertTriangle, ArrowRight, ArrowUpDown, BookOpen, Coins, CheckSquare, ChevronLeft, ChevronRight, Square as SquareIcon, Bot, Code2, Copy, Cpu, FileJson, Flag, GitFork, HelpCircle, Keyboard, LayoutGrid, Link2, Play, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, UserRound, Workflow, Wrench, X, Zap, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
const VIEW_PATH: Record<View, string> = { overview: "/", graphs: "/graphs", templates: "/templates", runs: "/runs", guide: "/guide" };

type Landing = {
  graphs: GraphSummary[] | null;
  templates: TemplateInfo[];
  runs: RunInfo[];
  health: Health;
  refresh: () => void;
  create: () => void;
  fromTemplate: (slug: string) => void;
  onImport: () => void;
};
const LandingCtx = createContext<Landing | null>(null);
function useLanding(): Landing {
  const c = useContext(LandingCtx);
  if (!c) throw new Error("landing context missing");
  return c;
}
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

/** How many list rows fit in a box whose height is set by flex, not by its content. */
function useFitList(ref: React.RefObject<HTMLElement | null>, row: number, min = 3) {
  const [n, setN] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setN(Math.max(min, Math.floor((entries[0]?.contentRect.height ?? 0) / row))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, row, min]);
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

/** Shared shell for the landing routes: app bar, data, the right rail and the free-tier note. Pages render the view. */
export function LandingShell({ children }: { children: React.ReactNode }) {
  const [graphs, setGraphs] = useState<GraphSummary[] | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [health, setHealth] = useState<Health>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const refresh = () => api.listGraphs().then(setGraphs).catch((e) => setError(String(e)));
  useEffect(() => {
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
  const isHome = usePathname() === "/";

  return (
    <LandingCtx.Provider value={{ graphs, templates, runs, health, refresh, create, fromTemplate, onImport }}>
      <main className="relative min-h-full overflow-x-hidden">
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        <AppBar health={health} onImport={onImport} onNew={create} />

        {isHome ? (
          <>
            {error && <div className="mx-auto mt-4 max-w-[1200px] rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
            {children}
          </>
        ) : (
          <div className="mx-auto grid w-full max-w-[1600px] gap-4 px-4 py-4 md:px-6 xl:grid-cols-[minmax(0,1fr)_19rem] 2xl:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="flex min-h-[calc(100vh-5.5rem)] min-w-0 flex-col gap-4">
              {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
              {children}
            </div>
            <RightRail runs={runs} paused={runs.filter((r) => r.status === "paused").slice(0, 5)} graphs={graphs ?? []} health={health} />
          </div>
        )}
        <FreeTierToast />
      </main>
    </LandingCtx.Provider>
  );
}

/* ---------------- route views (thin wrappers over the context) ---------------- */

export function OverviewPage() {
  const c = useLanding();
  return <Overview runs={c.runs} graphs={c.graphs} templates={c.templates} fromTemplate={c.fromTemplate} onNew={c.create} />;
}
export function GraphsPage() {
  const c = useLanding();
  return <GraphsView graphs={c.graphs} refresh={c.refresh} onNew={c.create} />;
}
export function TemplatesPage() {
  const c = useLanding();
  return <TemplatesView templates={c.templates} fromTemplate={c.fromTemplate} onImport={c.onImport} onNew={c.create} />;
}
export function RunsPage() {
  const c = useLanding();
  return <RunsView runs={c.runs} graphs={c.graphs ?? []} />;
}
export function GuidePage() {
  return <Guide />;
}

function AppBar({ health, onImport, onNew }: { health: Health; onImport: () => void; onNew: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const view: View = (Object.keys(VIEW_PATH) as View[]).find((k) => VIEW_PATH[k] === pathname) ?? "overview";
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
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2.5 pr-2">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Agent Studio</span>
        </Link>
        <nav className="ml-2 hidden h-full items-stretch md:flex">
          {items.map(([Icon, label, key]) => (
            <Link key={key} href={VIEW_PATH[key]} data-active={view === key} className={`tab-underline flex items-center gap-1.5 px-3 text-[13px] font-medium transition ${view === key ? "text-fg" : "text-muted hover:text-fg"}`}>
              <Icon size={14} className={view === key ? "text-accent" : ""} /> {label}
            </Link>
          ))}
        </nav>
        <select value={view} onChange={(e) => router.push(VIEW_PATH[e.target.value as View])} className="input ml-1 w-auto py-1 text-xs md:hidden">
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

/** Bottom-right note about running on free tiers. Dismissed once per browser. */
function FreeTierToast() {
  const KEY = "free-tier-note-dismissed";
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      let seen = false;
      try { seen = localStorage.getItem(KEY) === "1"; } catch {}
      if (!seen) setShow(true);
    }, 900);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  const close = () => {
    setShow(false);
    try { localStorage.setItem(KEY, "1"); } catch {}
  };
  return (
    <div className="toast-in card fixed right-5 bottom-5 z-40 w-[22rem] overflow-hidden border-accent/30 p-4 text-xs leading-relaxed text-muted shadow-[0_20px_60px_-20px_rgb(0_0_0/0.8),0_0_0_1px_rgb(197_241_53/0.15)]" role="status">
      <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 h-36 w-36 rounded-full bg-accent/20 blur-2xl" />
      <button onClick={close} className="icon-btn absolute top-2 right-2 z-10" title="Dismiss" aria-label="Dismiss"><X size={14} /></button>
      <div className="relative flex gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink"><ShieldCheck size={17} /></span>
        <div className="min-w-0 pr-6">
          <div className="text-[13px] font-semibold text-fg">Free-tier friendly</div>
          <p className="mt-0.5">Runs cost about <b className="font-mono text-fg">$0.00007</b> each on Groq. Evals run 3 rows at a time and sweeps go model by model, so free rate limits hold.</p>
          <button onClick={close} className="btn btn-sm btn-ghost mt-2.5">Got it</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- right rail (every view) ---------------- */

function RightRail({ runs: allRuns, paused, graphs, health }: { runs: RunInfo[]; paused: RunInfo[]; graphs: GraphSummary[]; health: Health }) {
  const nameOf = Object.fromEntries(graphs.map((g) => [g.id, g.name]));
  const listRef = useRef<HTMLUListElement>(null);
  const fit = useFitList(listRef, 30);
  const runs = allRuns.slice(0, fit);
  const totalCost = runs.reduce((a, r) => a + (r.usage?.cost_usd ?? 0), 0);
  return (
    <aside className="grid min-w-0 gap-4 md:grid-cols-2 xl:flex xl:flex-col">
      <section className="card flex min-h-0 flex-col p-4 xl:flex-1">
        <CardHead icon={Activity} title="Recent runs" hint={`last ${runs.length}`} />
        {!allRuns.length && <p className="text-xs text-muted">No runs yet. Open a graph and press Run.</p>}
        <ul ref={listRef} className="-mx-2 min-h-[9.5rem] flex-1 space-y-0.5 overflow-hidden xl:min-h-0">
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
        {runs.length > 0 && <div className="mt-2 flex justify-between border-t border-edge pt-2.5 text-[11px] text-muted"><span>spent on these runs</span><b className="font-mono text-fg">${totalCost.toFixed(5)}</b></div>}
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


      <section className="card p-4">
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
        <div className="mt-3 space-y-2">
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

function Overview({ runs, graphs: graphsOrNull, templates, fromTemplate, onNew }: { runs: RunInfo[]; graphs: GraphSummary[] | null; templates: TemplateInfo[]; fromTemplate: (slug: string) => void; onNew: () => void }) {
  const graphs = graphsOrNull ?? [];
  const nameOf = Object.fromEntries(graphs.map((g) => [g.id, g.name]));
  const healthy = graphs.filter((g) => g.issues === 0).length;
  const byStatus: Record<string, number> = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const done = byStatus.done ?? 0, finished = done + (byStatus.error ?? 0) + (byStatus.cancelled ?? 0);
  const cost = runs.reduce((a, r) => a + (r.usage?.cost_usd ?? 0), 0);
  const calls = runs.reduce((a, r) => a + (r.usage?.llm_calls ?? 0), 0);
  const durations = runs.filter((r) => r.duration_ms != null && r.status === "done").map((r) => r.duration_ms as number).sort((a, b) => a - b);
  const p50 = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const paused = runs.filter((r) => r.status === "paused");
  const statusOrder = ["done", "running", "paused", "queued", "cancelled", "error"];
  const models = useModels().filter((m) => m.available);

  // hero canvas: the smallest example that shows every node type
  const [heroSpec, setHeroSpec] = useState<GraphSpec | null>(null);
  useEffect(() => {
    let alive = true;
    api.getTemplate("tweet-review").then((sp) => alive && setHeroSpec(sp)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // "now" is only known after mount: using the clock during server render would break hydration
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);
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

  const stats: [string, string, string][] = [
    [graphsOrNull ? String(graphs.length) : "–", "graphs", `${healthy} ready to run`],
    [String(runs.length), "runs", `${runs7} in the last 7 days`],
    [finished ? `${Math.round((done / finished) * 100)}%` : "–", "success rate", `${byStatus.error ?? 0} errors · ${paused.length} waiting on a human`],
    [`$${cost.toFixed(4)}`, "total spend", `${calls} model calls · p50 ${p50 != null ? (p50 / 1000).toFixed(1) + " s" : "–"}`],
  ];

  const features: [LucideIcon, string, string, React.ReactNode][] = [
    [
      Activity,
      "Rewind any run, fork from any step",
      "Every node completion is a checkpoint. Scrub back, see what changed, edit a variable and launch a new run from that point. The original stays untouched; compare the two side by side.",
      <ol key="tt" className="divide-y divide-edge rounded-xl border border-edge bg-panel-2/60 text-[11px]">
        {[["after Write draft", "paused", false], ["edited by hand", "fork", true], ["after Rewrite", "done", false]].map(([label, tag, hot]) => (
          <li key={String(label)} className={`flex items-center gap-2 px-3 py-1.5 ${hot ? "text-accent" : "text-muted"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${hot ? "bg-accent" : "bg-dim"}`} />
            <span className="flex-1 font-mono">{label}</span>
            <span className={`pill ${hot ? "bg-accent/15 text-accent" : "bg-panel-3 text-dim"}`}>{tag}</span>
          </li>
        ))}
      </ol>,
    ],
    [
      ShieldCheck,
      "Evals that point at the node",
      "Build a dataset, pick scorers, run it. Failures light up the node that wrote the bad value. Sweep candidate models for one node and apply the cheapest that still passes.",
      <div key="ev" className="space-y-1.5 rounded-xl border border-edge bg-panel-2/60 p-3 text-[11px]">
        {(models.length ? models.slice(0, 3) : [{ id: "groq/openai/gpt-oss-20b", tier: "small", input_per_m: 0.075 }, { id: "groq/qwen/qwen3.8-27b", tier: "medium", input_per_m: 0.29 }, { id: "groq/openai/gpt-oss-120b", tier: "large", input_per_m: 0.15 }]).map((m, i) => (
          <div key={m.id} className="flex items-center gap-2">
            <span className="w-24 truncate font-mono text-muted">{m.id.split("/").slice(-1)[0]}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-3"><div className={`h-full rounded-full ${i === 0 ? "bg-accent" : "bg-emerald-400/60"}`} style={{ width: `${[67, 67, 100][i]}%` }} /></div>
            <span className="w-8 text-right font-mono text-fg">{[67, 67, 100][i]}%</span>
            <span className={`pill ${i === 0 ? "bg-accent/15 text-accent" : "bg-panel-3 text-dim"}`}>{i === 0 ? "cheapest" : m.tier}</span>
          </div>
        ))}
      </div>,
    ],
    [
      UserRound,
      "Humans and tools in the loop",
      "Human nodes pause the run with a card that shows exactly what to approve. Tool nodes call built-ins or any MCP server you connect. Code nodes run Python in a Docker sandbox.",
      <div key="hl" className="rounded-xl border border-pink-400/30 bg-panel-2/60 p-3 text-[11px]">
        <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-fg"><UserRound size={11} className="text-pink-300" /> Human review is waiting for you</div>
        <div className="text-muted">Approve this draft? (yes/no)</div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="btn btn-sm btn-ghost pointer-events-none">Yes</span>
          <span className="btn btn-sm btn-ghost pointer-events-none">No</span>
          <span className="ml-auto flex gap-1">{["http_get", "mcp:demo:add"].map((t) => <span key={t} className="rounded-md border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">{t}</span>)}</span>
        </div>
      </div>,
    ],
  ];

  return (
    <div className="min-w-0">
      {/* hero */}
      <section className="relative overflow-hidden border-b border-edge">
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(60%_70%_at_50%_0%,black,transparent)]" />
        <div aria-hidden className="pointer-events-none absolute left-1/2 -top-56 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative mx-auto max-w-[1200px] px-6 pt-16 pb-10 text-center lg:pt-20">
          <span className="pill border border-accent/30 bg-accent/10 text-accent"><Zap size={11} /> Time-travel debugging for agent workflows</span>
          <h1 className="mx-auto mt-6 max-w-4xl text-[46px] leading-[1] font-semibold tracking-[-0.04em] md:text-[68px]">
            Build agents on a canvas.
            <br />
            <span className="bg-gradient-to-r from-accent via-accent to-emerald-300 bg-clip-text text-transparent">Run, rewind, fork.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[16px] leading-relaxed text-muted">
            Compose multi-agent workflows visually, watch tokens stream through every node, then scrub back to any checkpoint, edit the state and fork a new run from that step. Evals, model sweeps and MCP tools are built in.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onNew} className="btn btn-primary h-11 px-6 text-[14.5px]"><Plus size={16} strokeWidth={2.5} /> New graph</button>
            <Link href="/templates" className="btn btn-ghost h-11 px-6 text-[14.5px]"><Sparkles size={15} className="text-accent" /> Browse templates</Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-dim">
            {["Free tiers end to end", "LangGraph checkpoints", "MCP tools", "Docker sandbox"].map((t) => (
              <span key={t} className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-accent" /> {t}</span>
            ))}
          </div>
        </div>

        {/* product window */}
        <div className="relative mx-auto max-w-[1100px] px-6 pb-12">
          <div aria-hidden className="pointer-events-none absolute inset-x-16 -top-6 h-40 rounded-full bg-accent/20 blur-3xl" />
          <div className="card relative overflow-hidden shadow-[0_40px_120px_-40px_rgb(0_0_0/0.95)] ring-1 ring-accent/25">
            <div className="flex items-center gap-2 border-b border-edge bg-panel-2/80 px-3 py-2">
              <span className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" /></span>
              <span className="ml-3 flex items-center gap-2 rounded-md border border-edge-2 bg-panel px-2 py-0.5 font-mono text-[11px] text-muted"><Logo size="sm" /> {heroSpec?.name ?? "Tweet writer with human review"}</span>
              <span className="ml-auto flex items-center gap-2">
                <span className="pill border border-edge-2 bg-panel text-muted">Saved · v6</span>
                <span className="pill border border-accent/30 bg-accent/10 text-accent"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> replaying a run</span>
              </span>
            </div>
            <div className="relative h-[460px]">
              {heroSpec ? <TemplatePreview spec={heroSpec} simulate /> : <div className="grid h-full place-items-center px-6"><HeroFlow /></div>}
              {/* floating product moments */}
              <div className="pointer-events-none absolute top-5 left-5 w-60 rounded-xl border border-edge-2 bg-panel/95 p-3 text-[11px] shadow-xl backdrop-blur">
                <div className="mb-1.5 flex items-center justify-between"><span className="font-semibold text-fg">Run state</span><span className="font-mono text-dim">step 2 / 8</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-panel-3"><div className="h-full w-1/4 rounded-full bg-accent" /></div>
                <div className="mt-2 space-y-1 font-mono text-[10.5px]">
                  <div className="flex justify-between text-muted"><span>after Write draft</span><span className="text-pink-300">paused</span></div>
                  <div className="flex justify-between text-accent"><span>edited by hand</span><span>fork</span></div>
                </div>
                <div className="mt-2.5 rounded-md bg-accent px-2 py-1 text-center text-[10.5px] font-semibold text-accent-ink">Edit state &amp; fork from step 2</div>
              </div>
              <div className="pointer-events-none absolute right-5 bottom-5 w-64 rounded-xl border border-pink-400/40 bg-panel/95 p-3 text-[11px] shadow-xl backdrop-blur">
                <div className="mb-1 flex items-center gap-1.5 font-semibold text-fg"><UserRound size={11} className="text-pink-300" /> Human review is waiting for you</div>
                <div className="text-muted">Approve this draft? (yes/no)</div>
                <div className="mt-2 flex gap-1.5"><span className="btn btn-sm btn-ghost">Yes</span><span className="btn btn-sm btn-ghost">No</span><span className="input ml-auto h-7 w-24 py-0 text-[10px] text-dim">or type…</span></div>
              </div>
            </div>
            <div className="flex items-center gap-3 border-t border-edge bg-panel-2/80 px-3 py-2 text-[11px] text-muted">
              {[["Timeline", true], ["Console", false], ["Runs", false], ["Compare", false], ["Evals", false], ["Cost", false], ["Tools", false]].map(([t, on]) => (
                <span key={String(t)} className={on ? "border-b-2 border-accent pb-0.5 text-fg" : ""}>{t}</span>
              ))}
              <span className="pill ml-auto border border-edge-2 bg-panel text-muted"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> done · 2 calls · $0.00007</span>
            </div>
          </div>
        </div>

        {/* stats strip */}
        <div className="relative border-t border-edge bg-panel/60 backdrop-blur">
          <div className="mx-auto grid max-w-[1200px] grid-cols-2 divide-x divide-edge px-6 md:grid-cols-4">
            {stats.map(([value, label, sub]) => (
              <div key={label} className="px-6 py-4 first:pl-0">
                <div className="text-[28px] font-semibold tabular-nums leading-none tracking-tight">{value}</div>
                <div className="mt-1.5 text-[12.5px] font-medium text-fg/85">{label}</div>
                <div className="text-[11px] text-dim">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* features */}
      <section className="border-b border-edge bg-[radial-gradient(60%_60%_at_80%_0%,rgb(197_241_53/0.06),transparent)]">
        <div className="mx-auto max-w-[1200px] px-6 py-12">
          <div className="eyebrow">Why Agent Studio</div>
          <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.02em]">Debug agents like code, not like black boxes.</h2>
          <p className="mt-2 max-w-2xl text-[14px] text-muted">Console, timeline, cost and traces all derive from one event log, so what you see on the canvas is what actually ran.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {features.map(([Icon, title, body, visual]) => (
              <div key={title} className="card flex flex-col p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20"><Icon size={18} /></span>
                <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
                <div className="mt-5">{visual}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* this workspace */}
      <section className="border-b border-edge bg-panel/40">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-6 py-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex min-w-0 flex-col">
            <div className="eyebrow">This workspace</div>
            <div className="mt-2 flex items-baseline justify-between gap-4">
              <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Runs, last 7 days</h2>
              <span className="font-mono text-[12px] text-dim">{runs7} runs · ${series.reduce((a, b) => a + b.cost, 0).toFixed(5)}</span>
            </div>
            <div className="mt-2 flex h-[230px] flex-col">
              {dayStart ? <RunsLine series={series} /> : <div className="mt-3 flex-1 animate-pulse rounded-lg bg-panel-3/40" />}
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[15px] font-semibold">Run outcomes</h3>
              <Link href="/runs" className="flex items-center gap-1 text-[12px] text-muted hover:text-fg">All runs <ArrowRight size={12} /></Link>
            </div>
            <div className="mt-4 flex items-center gap-5">
              <Donut
                parts={statusOrder.filter((k) => byStatus[k]).map((k) => [k, byStatus[k], statusColors[k] ?? "#71717a"])}
                size={124}
                center={<><div className="text-[22px] font-semibold tabular-nums leading-none tracking-tight">{finished ? `${Math.round((done / finished) * 100)}%` : "–"}</div><div className="mt-1 text-[9.5px] font-medium tracking-wider text-dim uppercase">success</div></>}
              />
              <ul className="min-w-0 flex-1 space-y-2 text-[11px]">
                {statusOrder.filter((k) => byStatus[k]).map((k) => (
                  <li key={k}>
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColors[k] ?? "#71717a" }} /><span className="flex-1 capitalize text-muted">{k}</span><span className="font-mono tabular-nums text-fg">{byStatus[k]}</span><span className="w-8 text-right font-mono text-dim">{Math.round((byStatus[k] / (runs.length || 1)) * 100)}%</span></div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-3"><div className="h-full rounded-full" style={{ width: `${(byStatus[k] / (runs.length || 1)) * 100}%`, background: statusColors[k] ?? "#71717a" }} /></div>
                  </li>
                ))}
                {!runs.length && <li className="text-dim">no runs yet</li>}
              </ul>
            </div>
            <ul className="mt-5 divide-y divide-edge border-t border-edge text-[12px]">
              {runs.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <Link href={`/graphs/${r.graph_id}`} className="flex items-center gap-2 py-2 transition hover:text-accent">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${runTone[r.status] ?? "bg-zinc-500"}`} />
                    <span className="min-w-0 flex-1 truncate text-fg">{nameOf[r.graph_id] ?? "graph"}</span>
                    <span className="shrink-0 text-dim">{r.status}</span>
                    <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-dim">{ago(r.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {paused.length > 0 && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-pink-400/25 bg-pink-400/[.06] px-3 py-2 text-[12px]">
                <UserRound size={13} className="text-pink-300" />
                <span className="text-fg">{paused.length} run{paused.length > 1 ? "s" : ""} waiting on you</span>
                <Link href={`/graphs/${paused[0].graph_id}`} className="ml-auto flex items-center gap-1 text-pink-300 hover:underline">Open <ArrowRight size={12} /></Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* templates */}
      <section className="border-b border-edge">
        <div className="mx-auto max-w-[1200px] px-6 py-12">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="eyebrow">Start fast</div>
              <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.02em]">Start from a template</h2>
            </div>
            <Link href="/templates" className="btn btn-ghost">Browse all <ArrowRight size={14} /></Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {templates.map((t) => {
              const Icon = templateIcon[t.id] ?? Workflow;
              return (
                <button key={t.id} onClick={() => fromTemplate(t.id)} className="group flex flex-col rounded-2xl border border-edge bg-panel p-4 text-left transition hover:-translate-y-0.5 hover:border-accent/40">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition group-hover:bg-accent group-hover:text-accent-ink"><Icon size={18} /></span>
                  <span className="mt-4 text-[14.5px] font-semibold tracking-tight">{t.name}</span>
                  <span className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-muted">{t.description}</span>
                  <span className="mt-4 flex items-center justify-between border-t border-edge pt-3 text-[11px] text-dim"><span>{t.nodes} nodes</span><span className="flex items-center gap-1 transition group-hover:text-accent">Use <ArrowRight size={12} /></span></span>
                </button>
              );
            })}
            {!templates.length && <div className="col-span-full rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-muted">No templates available.</div>}
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-6 text-[12px] text-dim">
        <span className="flex items-center gap-2 text-fg"><Logo size="sm" /> Agent Studio</span>
        <span>Next.js · React Flow · FastAPI · LangGraph · Postgres</span>
        <span className="ml-auto flex items-center gap-3"><span><kbd className="kbd">⌘K</kbd> commands</span><span><kbd className="kbd">⌘↵</kbd> run</span><Link href="/guide" className="hover:text-fg">How it works</Link></span>
      </footer>
    </div>
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
  const cols: NodeType[] = ["llm", "router", "human", "tool", "code"];
  const Icon = current ? (templateIcon[current.id] ?? Workflow) : Workflow;
  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      {/* master list */}
      <aside className="card flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles size={14} className="text-accent" /> Templates</div>
          <span className="text-[11px] text-dim">{templates.length} ready to use</span>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-edge overflow-y-auto">
          {templates.map((t) => {
            const I = templateIcon[t.id] ?? Workflow;
            const active = current?.id === t.id;
            return (
              <li key={t.id}>
                <button onClick={() => setPicked(t.id)} onDoubleClick={() => fromTemplate(t.id)} className={`relative flex w-full gap-3 px-4 py-3 text-left transition ${active ? "bg-accent/[.06]" : "hover:bg-panel-2"}`}>
                  {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-accent" />}
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ${active ? "bg-accent text-accent-ink ring-accent/40" : "bg-accent/10 text-accent ring-accent/20"}`}><I size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-[13px] font-semibold tracking-tight ${active ? "text-fg" : "text-fg/90"}`}>{t.name}</span>
                      <span className="shrink-0 font-mono text-[10px] text-dim">{t.nodes} nodes</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted">{t.description}</span>
                    <span className="mt-1.5 flex items-center gap-1">
                      {cols.map((k) => {
                        const m = typeMeta[k];
                        const on = t.node_types.includes(k);
                        return <span key={k} title={m.label} className={`grid h-4.5 w-4.5 place-items-center rounded ${on ? m.cls : "bg-panel-3 text-dim/50"}`}><m.icon size={10} /></span>;
                      })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {!templates.length && <li className="px-4 py-6 text-center text-xs text-muted">No templates available.</li>}
        </ul>
        <div className="border-t border-edge p-2">
          <button onClick={onNew} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition hover:bg-panel-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-panel-3 text-muted ring-1 ring-edge-2"><Plus size={14} /></span>
            <span className="min-w-0 flex-1"><span className="block font-medium text-fg">Blank graph</span><span className="block text-[10.5px] text-dim">Start and End only</span></span>
            <ArrowRight size={12} className="text-dim" />
          </button>
          <button onClick={onImport} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition hover:bg-panel-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-panel-3 text-muted ring-1 ring-edge-2"><FileJson size={14} /></span>
            <span className="min-w-0 flex-1"><span className="block font-medium text-fg">Import JSON</span><span className="block text-[10.5px] text-dim">Exported from the editor menu</span></span>
            <ArrowRight size={12} className="text-dim" />
          </button>
        </div>
      </aside>

      {/* detail */}
      <section className="card relative flex min-h-[28rem] min-w-0 flex-col overflow-hidden">
        {current ? (
          <>
            <div className="relative overflow-hidden border-b border-edge">
              <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_right,black,transparent_70%)] opacity-60" />
              <div className="relative flex flex-wrap items-center gap-4 px-5 py-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink shadow-[0_8px_24px_-8px_rgb(197_241_53/0.6)]"><Icon size={22} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[18px] font-semibold tracking-tight">{current.name}</h2>
                    <span className="pill border border-edge-2 bg-panel-2 text-muted">{current.nodes} nodes</span>
                    {shownSpec && <span className="pill border border-edge-2 bg-panel-2 text-muted">{shownSpec.edges.length} edges</span>}
                  </div>
                  <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">{current.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <TypeChips types={current.node_types} />
                  <button onClick={() => fromTemplate(current.id)} className="btn btn-primary"><Plus size={14} strokeWidth={2.5} /> Use template</button>
                </div>
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              {shownSpec ? <TemplatePreview spec={shownSpec} /> : <div className="grid h-full place-items-center text-xs text-dim">Loading preview…</div>}
              <span className="pointer-events-none absolute top-2 right-3 rounded-md border border-edge-2 bg-panel/80 px-1.5 py-0.5 text-[10px] text-dim backdrop-blur">read-only preview</span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto border-t border-edge bg-panel-2/40 px-3 py-2">
              <span className="eyebrow shrink-0 pr-1">Nodes</span>
              {(shownSpec?.nodes ?? []).map((n) => {
                const m = typeMeta[n.type as NodeType];
                const c = n.config as Record<string, unknown>;
                const detail = String(c.model ?? c.tool ?? "");
                return (
                  <span key={n.id} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-edge-2 bg-panel px-2 py-1 text-[11px]">
                    <span className={`grid h-4.5 w-4.5 place-items-center rounded ${m.cls}`}><m.icon size={10} /></span>
                    <span className="font-medium text-fg">{n.label}</span>
                    {detail && <span className="font-mono text-[10px] text-dim">{detail.split("/").slice(-1)[0]}</span>}
                  </span>
                );
              })}
              <span className="ml-auto shrink-0 pl-2 text-[10.5px] text-dim">double-click a template to create it</span>
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-muted">Pick a template to preview it.</div>
        )}
      </section>
    </div>
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
  type Tab = "nodes" | "shortcuts" | "glossary" | "faq";
  const [tab, setTab] = useState<Tab>("nodes");
  const tabs: [Tab, LucideIcon, string][] = [
    ["nodes", Workflow, "Node types"],
    ["shortcuts", Keyboard, "Shortcuts"],
    ["glossary", BookOpen, "Glossary"],
    ["faq", HelpCircle, "Questions"],
  ];
  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      {/* stepper */}
      <section className="card relative flex min-w-0 flex-col overflow-hidden p-6">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="eyebrow">How it works</div>
        <h2 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Four loops, <span className="text-accent">one canvas.</span></h2>
        <p className="mt-1 text-[12.5px] text-muted">Everything below runs on free tiers.</p>
        <ol className="relative mt-6 mb-6 ml-4 flex flex-1 flex-col justify-evenly gap-6 border-l border-edge-2 pl-7">
          {steps.map(([Icon, title, body], i) => (
            <li key={title} className="relative">
              <span className="absolute top-0 -left-[2.45rem] grid h-7 w-7 place-items-center rounded-full border-2 border-canvas bg-accent font-mono text-[11px] font-bold text-accent-ink ring-1 ring-accent/40">{i + 1}</span>
              <div className="flex items-center gap-2 text-[15px] font-semibold"><Icon size={15} className="text-accent" /> {title}</div>
              <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
        <div className="rounded-r-xl border-l-2 border-accent bg-accent/[.06] px-4 py-3 pt-3 text-[12px] leading-relaxed text-muted">
          <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg"><Cpu size={13} className="text-accent" /> Under the hood</div>
          Each node completion is a LangGraph checkpoint in Postgres. A run is a pointer to the head of a checkpoint chain plus the events it emitted; forking creates a new checkpoint whose parent is the one you edited. Console, timeline, cost and traces all derive from the same event log.
        </div>
      </section>

      {/* tabbed reference */}
      <section className="card flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-stretch gap-0.5 border-b border-edge px-2">
          {tabs.map(([key, Icon, label]) => (
            <button key={key} data-active={tab === key} onClick={() => setTab(key)} className={`tab-underline flex items-center gap-1.5 px-3 text-[12.5px] font-medium transition ${tab === key ? "text-fg" : "text-muted hover:text-fg"}`}>
              <Icon size={13} className={tab === key ? "text-accent" : ""} /> {label}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {tab === "nodes" && (
            <ul className="flex flex-1 flex-col divide-y divide-edge">
              {order.map((k) => {
                const m = typeMeta[k];
                return (
                  <li key={k} className="flex flex-1 items-center gap-3 px-4 py-3 text-xs">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${m.cls}`}><m.icon size={16} /></span>
                    <span className="w-16 shrink-0 text-[13.5px] font-medium text-fg">{nodeMeta[k].title}</span>
                    <span className="min-w-0 flex-1 text-[12.5px] text-muted">{nodeMeta[k].hint}</span>
                    <span className="hidden rounded-md border border-edge-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[10.5px] text-dim lg:inline">{guideNotes[k]}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {tab === "shortcuts" && (
            <ul className="flex flex-1 flex-col divide-y divide-edge text-[13px]">
              {[["⌘K", "Open the command palette: add nodes, run, fit view, undo, delete."], ["⌘↵", "Run the graph. A dialog asks for the input variables no node produces."], ["⌘Z / ⇧⌘Z", "Undo and redo any canvas edit, including config changes."], ["⌫", "Delete the selected node or edge."], ["drag from a port", "Connect nodes. Routers have one port per branch along the bottom edge."], ["click a timeline bar", "Select that node and show the step's input, output and usage."]].map(([k, v]) => (
                <li key={k} className="flex flex-1 items-center gap-4 px-4 py-3"><kbd className="kbd shrink-0 text-[11px]">{k}</kbd><span className="text-muted">{v}</span></li>
              ))}
            </ul>
          )}
          {tab === "glossary" && (
            <dl className="flex flex-1 flex-col divide-y divide-edge text-[13px]">
              {glossary.map(([term, def]) => (
                <div key={term} className="flex flex-1 items-center gap-4 px-4 py-3">
                  <dt className="w-24 shrink-0 font-medium text-fg">{term}</dt>
                  <dd className="min-w-0 text-muted">{def}</dd>
                </div>
              ))}
            </dl>
          )}
          {tab === "faq" && (
            <ul className="flex flex-1 flex-col divide-y divide-edge text-[13px]">
              {faq.map(([q, a]) => (
                <li key={q} className="flex flex-1 flex-col justify-center px-4 py-3">
                  <div className="font-medium text-fg">{q}</div>
                  <p className="mt-0.5 leading-relaxed text-muted">{a}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
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
  const fmtT = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
        {days.map(([i, dt], k) => (
          <span key={i} className={`absolute ${k === 0 ? "" : k === days.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${(i / (n - 1)) * 100}%` }}>{dt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        ))}
      </div>
    </div>
  );
}

/* ---------------- charts ---------------- */

function Donut({ parts, size = 116, center }: { parts: [string, number, string][]; size?: number; center?: React.ReactNode }) {
  const total = parts.reduce((a, p) => a + p[1], 0) || 1;
  const r = size / 2 - 9, c = 2 * Math.PI * r;
  // precompute arc offsets: no mutation during render
  const arcs = parts.reduce<{ label: string; color: string; len: number; offset: number }[]>((acc, [label, v, color]) => {
    const offset = acc.reduce((a, x) => a + x.len, 0);
    return [...acc, { label, color, len: (v / total) * c, offset }];
  }, []);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={11} />
        {arcs.map((a) => (
          <circle key={a.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.color} strokeWidth={11} strokeDasharray={`${Math.max(0, a.len - 3)} ${c - Math.max(0, a.len - 3)}`} strokeDashoffset={-a.offset} />
        ))}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center"><div>{center}</div></div>}
    </div>
  );
}

