// Mirrors apps/api/app/schemas/graph.py. Keep the two in sync by hand for now.

export type NodeType = "start" | "end" | "llm" | "tool" | "router" | "human" | "code";

export type LLMConfig = {
  model: string;
  system_prompt: string;
  prompt: string;
  temperature: number;
  max_tokens: number;
  output_key: string;
};

export type ToolConfig = { tool: string; args: Record<string, unknown>; output_key: string };

export type RouterBranch = { label: string; when: string };
export type RouterConfig = {
  mode: "llm" | "rule";
  model: string;
  input_key: string;
  branches: RouterBranch[];
};

export type HumanConfig = { question: string; show_keys: string[]; output_key: string };
export type CodeConfig = { language: "python"; source: string; timeout_s: number };

export type NodeConfigMap = {
  start: Record<string, never>;
  end: Record<string, never>;
  llm: LLMConfig;
  tool: ToolConfig;
  router: RouterConfig;
  human: HumanConfig;
  code: CodeConfig;
};

export type SpecNode<T extends NodeType = NodeType> = {
  id: string;
  type: T;
  label: string;
  position: { x: number; y: number };
  config: NodeConfigMap[T];
};

export type SpecEdge = { id: string; source: string; target: string; label?: string | null };

export type Issue = { node?: string | null; edge?: string | null; message: string };

export type GraphSpec = {
  id: string;
  name: string;
  description?: string;
  version: number;
  nodes: SpecNode[];
  edges: SpecEdge[];
  issues: Issue[];
};

export type GraphSummary = {
  id: string;
  name: string;
  version: number;
  nodes: number;
  issues: number;
  shared?: boolean;
  updated_at: string;
};

export type ModelInfo = {
  id: string;
  provider: string;
  tier: "small" | "medium" | "large";
  context: number;
  input_per_m: number;
  output_per_m: number;
  available: boolean;
};

export type ToolInfo = { name: string; description: string; server: string | null; schema: Record<string, unknown> | null };

export const defaultConfig: { [K in NodeType]: NodeConfigMap[K] } = {
  start: {},
  end: {},
  llm: {
    model: "groq/openai/gpt-oss-20b",
    system_prompt: "",
    prompt: "{{input}}",
    temperature: 0.2,
    max_tokens: 1024,
    output_key: "output",
  },
  tool: { tool: "echo", args: { text: "" }, output_key: "tool_result" },
  router: {
    mode: "rule",
    model: "groq/openai/gpt-oss-20b",
    input_key: "output",
    branches: [
      { label: "yes", when: "output == 'yes'" },
      { label: "no", when: "output != 'yes'" },
    ],
  },
  human: { question: "Approve?", show_keys: [], output_key: "human_input" },
  code: { language: "python", source: "def main(state):\n    return {}\n", timeout_s: 10 },
};

export const nodeMeta: Record<NodeType, { title: string; hint: string }> = {
  start: { title: "Start", hint: "Entry point. Run input lands here." },
  end: { title: "End", hint: "Run finishes when it reaches this node." },
  llm: { title: "Model", hint: "Prompt a model, store the reply in a variable." },
  tool: { title: "Tool", hint: "Call a built-in or MCP tool." },
  router: { title: "Router", hint: "Branch by rule or by asking a model." },
  human: { title: "Human", hint: "Pause and wait for a person." },
  code: { title: "Code", hint: "Run a Python function over the variables." },
};

export type RunStatus = "queued" | "running" | "paused" | "done" | "error" | "cancelled";

export type RunUsage = { input_tokens: number; output_tokens: number; cost_usd: number; llm_calls: number };

export type RunInfo = {
  id: string;
  graph_id: string;
  graph_version: number;
  parent_run_id: string | null;
  fork_checkpoint_id: string | null;
  head_checkpoint_id: string | null;
  status: RunStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  interrupt: InterruptPayload | null;
  error: string | null;
  usage: Partial<RunUsage>;
  duration_ms: number | null;
  trace_url: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type InterruptPayload = { node: string; question: string; show: Record<string, unknown> };

/** One message on /ws/runs/{id}. seq is null for live-only events (token, status). */
export type RunEvent = {
  seq: number | null;
  type: string;
  node?: string | null;
  ts?: string;
  text?: string;
  status?: RunStatus;
  output?: Record<string, unknown>;
  usage?: Record<string, number | string>;
  input?: Record<string, unknown>;
  value?: unknown;
  error?: string;
  question?: string;
  show?: Record<string, unknown>;
  checkpoint_id?: string;
  replay?: boolean;
  attempt?: number;
  wait_s?: number;
  reason?: string;
};

export type Checkpoint = {
  checkpoint_id: string;
  parent_id: string | null;
  step: number | null;
  node: string | null; // node whose completion produced this checkpoint (null = run input)
  next: string[];
  created_at: string | null;
  vars: Record<string, unknown>;
  trace: Record<string, unknown>[];
  interrupted: boolean;
  forked: boolean; // produced by an edit-and-fork, not by a node
};

export type DatasetRow = { input: Record<string, unknown>; expected?: unknown; human?: unknown };
export type Dataset = { id: string; graph_id: string | null; name: string; rows: DatasetRow[]; updated_at: string };

export type ScorerKind = "exact" | "contains" | "regex" | "json_valid" | "max_length" | "llm_judge";
export type ScorerSpec = {
  kind: ScorerKind;
  key: string;
  expected_field?: string;
  case_sensitive?: boolean;
  pattern?: string | null;
  max_chars?: number | null;
  required_keys?: string[];
  rubric?: string;
  model?: string;
  pass_threshold?: number;
};

export type ScoreOut = { score: number; passed: boolean; detail: string; usage?: Record<string, number> };

export type EvalSummary = {
  rows: number;
  errors: number;
  pass_rate: number | null;
  scorers: Record<string, { kind: ScorerKind; key: string; n: number; pass_rate: number | null; avg_score: number | null; nodes: string[] }>;
  node_failure_share: Record<string, number>;
  cost_usd: number;
  avg_duration_ms: number;
};

export type EvalRunInfo = {
  id: string;
  graph_id: string;
  graph_version: number;
  dataset_id: string;
  dataset_name?: string;
  scorers: ScorerSpec[];
  sweep_id: string | null;
  node_id: string | null;
  variant: string | null;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  total: number;
  completed: number;
  summary: EvalSummary | Record<string, never>;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type EvalResultRow = {
  row_index: number;
  run_id: string | null;
  output: Record<string, unknown> | null;
  scores: Record<string, ScoreOut>;
  usage: Record<string, number>;
  duration_ms: number | null;
  error: string | null;
  input?: Record<string, unknown>;
  expected?: unknown;
};

export type Sweep = { sweep_id: string; node_id: string; variants: EvalRunInfo[]; recommended: string | null; done: boolean };
export type SweepSummary = { sweep_id: string; node_id: string; models: string[]; created_at: string; status: "done" | "running" };

export type StatBucket = {
  calls: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  avg_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
};
export type GraphStats = { runs: number; nodes: Record<string, StatBucket>; models: Record<string, StatBucket>; total: StatBucket };

export type MCPServerInfo = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
  status: "connected" | "connecting" | "stopped" | "disconnected";
  last_error: string | null;
  updated_at: string;
};
export type MCPServerBody = { name: string; transport: "stdio" | "http"; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };

export type TemplateInfo = { id: string; name: string; description: string; nodes: number; node_types: NodeType[] };
