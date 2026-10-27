import type { GraphSpec, GraphSummary, ModelInfo, SpecEdge, SpecNode, ToolInfo } from "./types";

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
  listTools: () => request<ToolInfo[]>("/tools"),
};
