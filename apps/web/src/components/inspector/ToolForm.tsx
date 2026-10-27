"use client";

import { useState } from "react";
import type { ToolConfig } from "@/lib/types";
import { useTools } from "@/lib/useCatalog";
import { CodeField } from "./CodeField";
import { Field, Select, TextInput, VarChips } from "./Field";

type Props = { config: ToolConfig; vars: string[]; onChange: (patch: Partial<ToolConfig>) => void };

export function ToolForm({ config, vars, onChange }: Props) {
  const tools = useTools();
  const current = tools.find((t) => t.name === config.tool);
  const [argsText, setArgsText] = useState(() => JSON.stringify(config.args ?? {}, null, 2));
  const [argsError, setArgsError] = useState<string | null>(null);

  const onArgs = (text: string) => {
    setArgsText(text);
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) throw new Error("must be an object");
      setArgsError(null);
      onChange({ args: parsed });
    } catch (e) {
      setArgsError(e instanceof Error ? e.message : "invalid JSON");
    }
  };

  return (
    <div className="space-y-3">
      <Field label="Tool" hint={current?.description}>
        <Select value={config.tool} onChange={(e) => onChange({ tool: e.target.value })}>
          {!tools.length && <option value={config.tool}>{config.tool}</option>}
          <optgroup label="built-in">
            {tools.filter((t) => !t.server).map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </optgroup>
          {[...new Set(tools.filter((t) => t.server).map((t) => t.server))].map((srv) => (
            <optgroup key={srv!} label={`MCP · ${srv}`}>
              {tools.filter((t) => t.server === srv).map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name.split(":").slice(2).join(":")}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      {current?.schema && typeof current.schema.properties === "object" && current.schema.properties && (
        <p className="text-[11px] text-muted">
          expects{" "}
          {Object.entries(current.schema.properties as Record<string, { type?: string }>).map(([k, v], i, arr) => (
            <span key={k}>
              <span className="font-mono text-sky-300">{k}</span>
              {v?.type ? <span className="text-muted/70">: {v.type}</span> : null}
              {i < arr.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      )}
      <Field label="Arguments" hint={argsError ?? "JSON, values may use {{vars}}"}>
        <CodeField language="json" value={argsText} onChange={onArgs} height={110} />
      </Field>
      {argsError && <p className="text-[11px] text-amber-300">{argsError}</p>}
      <VarChips keys={vars} onPick={(k) => navigator.clipboard?.writeText(`{{${k}}}`)} empty="No upstream variables yet." />
      <Field label="Store result as" hint="variable name">
        <TextInput value={config.output_key} onChange={(e) => onChange({ output_key: e.target.value.replace(/[^\w]/g, "_") })} className="font-mono" />
      </Field>
    </div>
  );
}
