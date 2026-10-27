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

export type ToolInfo = { name: string; description: string };

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
