"use client";

import type { LLMConfig } from "@/lib/types";
import { useModels } from "@/lib/useCatalog";
import { CodeField } from "./CodeField";
import { Field, Select, TextInput, VarChips } from "./Field";

type Props = { config: LLMConfig; vars: string[]; onChange: (patch: Partial<LLMConfig>) => void };

export function LLMForm({ config, vars, onChange }: Props) {
  const models = useModels();
  const current = models.find((m) => m.id === config.model);
  return (
    <div className="space-y-3">
      <Field label="Model" hint={current ? `${current.tier} · $${current.input_per_m}/$${current.output_per_m} per 1M` : undefined}>
        <Select value={config.model} onChange={(e) => onChange({ model: e.target.value })}>
          {!models.length && <option value={config.model}>{config.model}</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.available}>
              {m.id.split("/").slice(1).join("/")} · {m.tier}
              {m.available ? "" : " (no key)"}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="System prompt" hint="optional">
        <CodeField language="prompt" value={config.system_prompt} onChange={(v) => onChange({ system_prompt: v })} height={70} />
      </Field>

      <Field label="Prompt">
        <CodeField language="prompt" value={config.prompt} onChange={(v) => onChange({ prompt: v })} height={130} />
      </Field>
      <VarChips keys={vars} onPick={(k) => onChange({ prompt: `${config.prompt}{{${k}}}` })} empty="No upstream variables yet. Run input keys are also available." />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Temperature" hint={String(config.temperature)}>
          <input type="range" min={0} max={2} step={0.1} value={config.temperature} onChange={(e) => onChange({ temperature: Number(e.target.value) })} className="w-full accent-sky-400" />
        </Field>
        <Field label="Max tokens">
          <TextInput type="number" min={1} max={32000} value={config.max_tokens} onChange={(e) => onChange({ max_tokens: Math.min(32000, Math.max(1, Number(e.target.value) || 1)) })} />
        </Field>
      </div>

      <Field label="Store reply as" hint="variable name">
        <TextInput value={config.output_key} onChange={(e) => onChange({ output_key: e.target.value.replace(/[^\w]/g, "_") })} className="font-mono" />
      </Field>
    </div>
  );
}
