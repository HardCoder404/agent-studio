"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { ModelInfo, ToolInfo } from "./types";

// Tiny module-level cache: the catalogs rarely change and every form wants them.
let models: ModelInfo[] | null = null;
let tools: ToolInfo[] | null = null;
let modelsP: Promise<ModelInfo[]> | null = null;
let toolsP: Promise<ToolInfo[]> | null = null;

export function useModels(): ModelInfo[] {
  const [v, setV] = useState<ModelInfo[]>(models ?? []);
  useEffect(() => {
    if (models) return;
    modelsP ??= api.listModels().then((m) => (models = m));
    modelsP.then(setV).catch(() => {});
  }, []);
  return v;
}

export function useTools(): ToolInfo[] {
  const [v, setV] = useState<ToolInfo[]>(tools ?? []);
  useEffect(() => {
    if (tools) return;
    toolsP ??= api.listTools().then((t) => (tools = t));
    toolsP.then(setV).catch(() => {});
  }, []);
  return v;
}
