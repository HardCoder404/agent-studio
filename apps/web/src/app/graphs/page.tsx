"use client";

import { Activity, AlertTriangle, ArrowRight, BookOpen, Bot, Code2, Copy, Cpu, Flag, GitFork, Keyboard, LayoutGrid, Link2, Play, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, UserRound, Workflow, Wrench, type LucideIcon } from "lucide-react";
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
  const [q, setQ] = useState("");
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [health, setHealth] = useState<{ groq?: boolean; gemini?: boolean; langfuse?: boolean; code_sandbox?: string; budget?: { used: number; limit: number | null } } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const refresh = () => api.listGraphs().then(setGraphs).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
    api.listTemplates().then(setTemplates).catch(() => {});
    fetch(`${API_URL}/runs?limit=8`).then((r) => r.json()).then(setRuns).catch(() => {});
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

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (graphs ?? []).filter((g) => !needle || g.name.toLowerCase().includes(needle));
  }, [graphs, q]);
  const healthy = (graphs ?? []).filter((g) => g.issues === 0).length;

  return (
    <main className="relative min-h-full overflow-x-hidden">
      {/* ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_50%_at_50%_0%,rgb(56_189_248/0.18),transparent_70%)]" />
      <div aria-hidden className="pointer-events-none absolute -left-40 top-40 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-40 top-80 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative mx-auto grid max-w-[1600px] grid-cols-1 gap-8 px-6 pt-8 pb-24 lg:grid-cols-[13rem_minmax(0,1fr)_19rem]">
        <SideNav />
        <div className="min-w-0">
        {/* hero */}
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

        {error && <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

        {/* templates */}
        {templates.length > 0 && (
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
        <section id="graphs" className="scroll-mt-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold tracking-tight">Your graphs</h2>
            <label className="flex items-center gap-2 rounded-lg border border-edge bg-panel/60 px-3 py-1.5 text-xs text-muted focus-within:border-sky-500/50">
              <Search size={13} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search graphs" className="w-44 bg-transparent text-fg outline-none placeholder:text-muted/60" />
            </label>
          </div>

          {graphs && graphs.length === 0 && (
            <div className="rounded-2xl border border-dashed border-edge p-10 text-center text-sm text-muted">
              No graphs yet. Pick a template above or create a blank one.
            </div>
          )}
          {graphs && graphs.length > 0 && shown.length === 0 && <p className="text-sm text-muted">Nothing matches “{q}”.</p>}

          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((g) => (
              <li key={g.id} className="group relative rounded-2xl border border-edge bg-panel p-4 transition hover:border-white/15 hover:shadow-xl hover:shadow-black/30">
                <Link href={`/graphs/${g.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="line-clamp-2 min-w-0 text-sm font-semibold leading-snug tracking-tight" title={g.name}>{g.name}</div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {g.shared && <Link2 size={13} className="text-sky-300" aria-label="shared with a link" />}
                      {g.issues > 0 ? (
                        <span className="flex items-center gap-1 rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300" title="Unresolved issues">
                          <AlertTriangle size={10} /> {g.issues}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">ready</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] text-muted">
                    {g.nodes} nodes · v{g.version} · {new Date(g.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                </Link>
                <div className="mt-3 flex items-center justify-between">
                  <Link href={`/graphs/${g.id}`} className="flex items-center gap-1 text-xs font-medium text-sky-300 opacity-0 transition group-hover:opacity-100">
                    Open <ArrowRight size={12} />
                  </Link>
                  <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button onClick={() => duplicate(g.id)} className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg" title="Duplicate">
                      <Copy size={13} />
                    </button>
                    <button onClick={() => remove(g.id)} className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-rose-400" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
        </div>
        <RightRail runs={runs} graphs={graphs ?? []} health={health} />
      </div>
    </main>
  );
}

function SideNav() {
  const items: [LucideIcon, string, string][] = [
    [LayoutGrid, "Graphs", "#graphs"],
    [Sparkles, "Templates", "#templates"],
    [Activity, "Recent runs", "#runs"],
    [BookOpen, "How it works", "#how"],
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
          {items.map(([Icon, label, href]) => (
            <a key={label} href={href} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-fg">
              <Icon size={15} /> {label}
            </a>
          ))}
        </nav>
        <div className="rounded-xl border border-edge bg-panel/60 p-3 text-[11px] leading-relaxed text-muted">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium text-fg"><Keyboard size={12} /> Shortcuts</div>
          <div><kbd className="rounded border border-edge px-1 font-mono">⌘K</kbd> commands</div>
          <div><kbd className="rounded border border-edge px-1 font-mono">⌘↵</kbd> run graph</div>
          <div><kbd className="rounded border border-edge px-1 font-mono">⌘Z</kbd> undo · <kbd className="rounded border border-edge px-1 font-mono">⌫</kbd> delete</div>
        </div>
        <div className="space-y-2 rounded-xl border border-edge bg-panel/60 p-3 text-[11px] text-muted">
          <div className="flex items-center gap-1.5 font-medium text-fg"><BookOpen size={12} /> How it works</div>
          {["Compose nodes on the canvas", "Run; answer human gates live", "Scrub checkpoints, edit state, fork", "Eval, sweep models, ship"].map((t, i) => (
            <div key={t} className="flex gap-2"><span className="text-sky-300">{i + 1}.</span> {t}</div>
          ))}
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
