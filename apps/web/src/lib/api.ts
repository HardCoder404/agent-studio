import type { Checkpoint, Dataset, DatasetRow, EvalResultRow, EvalRunInfo, GraphSpec, GraphStats, Sweep, SweepSummary, GraphSummary, ModelInfo, RunEvent, RunInfo, ScorerSpec, SpecEdge, SpecNode, ToolInfo } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL = API_URL.replace(/^http/, "ws");

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.detail ?? body);
  return body as T;
}

export type GraphBody = { name: string; nodes: SpecNode[]; edges: SpecEdge[] };

export const api = {
  listGraphs: () => request<GraphSummary[]>("/graphs"),
  getGraph: (id: string) => request<GraphSpec>(`/graphs/${id}`),
  createGraph: (body: GraphBody) => request<GraphSpec>("/graphs", { method: "POST", body: JSON.stringify(body) }),
  updateGraph: (id: string, body: GraphBody) =>
    request<GraphSpec>(`/graphs/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteGraph: (id: string) => request<void>(`/graphs/${id}`, { method: "DELETE" }),
  listModels: () => request<ModelInfo[]>("/models"),
  createRun: (graph_id: string, input: Record<string, unknown>) =>
    request<RunInfo>("/runs", { method: "POST", body: JSON.stringify({ graph_id, input }) }),
  listRuns: (graphId: string) => request<RunInfo[]>(`/runs?graph_id=${graphId}&limit=30`),
  getRun: (id: string) => request<RunInfo>(`/runs/${id}`),
  getRunEvents: (id: string) => request<RunEvent[]>(`/runs/${id}/events`),
  getCheckpoints: (id: string) => request<Checkpoint[]>(`/runs/${id}/checkpoints`),
  listDatasets: (graphId: string) => request<Dataset[]>(`/datasets?graph_id=${graphId}`),
  createDataset: (body: { graph_id: string; name: string; rows: DatasetRow[] }) =>
    request<Dataset>("/datasets", { method: "POST", body: JSON.stringify(body) }),
  updateDataset: (id: string, body: { name: string; rows: DatasetRow[] }) =>
    request<Dataset>(`/datasets/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteDataset: (id: string) => request<void>(`/datasets/${id}`, { method: "DELETE" }),
  listEvals: (graphId: string) => request<EvalRunInfo[]>(`/evals?graph_id=${graphId}`),
  createEval: (body: { graph_id: string; dataset_id: string; scorers: ScorerSpec[] }) =>
    request<EvalRunInfo>("/evals", { method: "POST", body: JSON.stringify(body) }),
  getEval: (id: string) => request<EvalRunInfo & { results: EvalResultRow[] }>(`/evals/${id}`),
  cancelEval: (id: string) => request<EvalRunInfo>(`/evals/${id}/cancel`, { method: "POST" }),
  createSweep: (body: { graph_id: string; dataset_id: string; scorers: ScorerSpec[]; node_id: string; models: string[] }) =>
    request<{ sweep_id: string; node_id: string; evals: EvalRunInfo[] }>("/evals/sweep", { method: "POST", body: JSON.stringify(body) }),
  getSweep: (id: string) => request<Sweep>(`/evals/sweeps/${id}`),
  listSweeps: (graphId: string) => request<SweepSummary[]>(`/evals/sweeps?graph_id=${graphId}`),
  getStats: (graphId: string) => request<GraphStats>(`/graphs/${graphId}/stats`),
  forkRun: (id: string, checkpoint_id: string, vars: Record<string, unknown>) =>
    request<RunInfo>(`/runs/${id}/fork`, { method: "POST", body: JSON.stringify({ checkpoint_id, vars }) }),
  resumeRun: (id: string, value: unknown) => request<RunInfo>(`/runs/${id}/resume`, { method: "POST", body: JSON.stringify({ value }) }),
  cancelRun: (id: string) => request<RunInfo>(`/runs/${id}/cancel`, { method: "POST" }),
  listTools: () => request<ToolInfo[]>("/tools"),
};
