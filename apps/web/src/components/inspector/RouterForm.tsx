"use client";

import { Plus, X } from "lucide-react";
import type { RouterConfig } from "@/lib/types";
import { useModels } from "@/lib/useCatalog";
import { useGraphStore } from "@/store/graph";
import { Field, Select, TextInput } from "./Field";

type Props = { nodeId: string; config: RouterConfig; vars: string[]; onChange: (patch: Partial<RouterConfig>) => void };

export function RouterForm({ nodeId, config, vars, onChange }: Props) {
  const models = useModels();
  const renameBranch = useGraphStore((s) => s.renameBranch);
  const removeBranch = useGraphStore((s) => s.removeBranch);
  const isLLM = config.mode === "llm";

  const setWhen = (label: string, when: string) =>
    onChange({ branches: config.branches.map((b) => (b.label === label ? { ...b, when } : b)) });

  const addBranch = () => {
    let i = config.branches.length + 1;
    while (config.branches.some((b) => b.label === `branch${i}`)) i++;
    onChange({ branches: [...config.branches, { label: `branch${i}`, when: isLLM ? "describe when to take this branch" : "True" }] });
  };

  return (
    <div className="space-y-3">
      <Field label="Mode">
        <div className="grid grid-cols-2 gap-1 rounded-md border border-edge bg-canvas p-1">
          {(["rule", "llm"] as const).map((m) => (
            <button key={m} type="button" onClick={() => onChange({ mode: m })} className={`rounded px-2 py-1 text-xs ${config.mode === m ? "bg-violet-500/20 text-violet-200" : "text-muted hover:text-fg"}`}>
              {m === "rule" ? "Rule (expression)" : "Ask a model"}
            </button>
          ))}
        </div>
      </Field>

      {isLLM && (
        <Field label="Model">
          <Select value={config.model} onChange={(e) => onChange({ model: e.target.value })}>
            {!models.length && <option value={config.model}>{config.model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.id.split("/").slice(1).join("/")} · {m.tier}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label={isLLM ? "Decide using variable" : "Variables in scope"} hint={isLLM ? undefined : vars.join(", ") || "none upstream"}>
        {isLLM ? (
          <Select value={config.input_key} onChange={(e) => onChange({ input_key: e.target.value })}>
            {![...vars, config.input_key].length && <option value="">—</option>}
            {[...new Set([config.input_key, ...vars])].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-[11px] text-muted">Branches are tried top to bottom; the first true expression wins, the last branch is the fallback.</p>
        )}
      </Field>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted">
          <span>Branches</span>
          <button type="button" onClick={addBranch} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-violet-300 hover:bg-white/5">
            <Plus size={11} /> add
          </button>
        </div>
        <div className="space-y-2">
          {config.branches.map((b) => (
            <div key={b.label} className="rounded-md border border-edge bg-canvas p-2">
              <div className="flex items-center gap-1.5">
                <TextInput
                  defaultValue={b.label}
                  onBlur={(e) => {
                    const to = e.target.value.trim().replace(/\s+/g, "_");
                    if (to && to !== b.label && !config.branches.some((x) => x.label === to)) renameBranch(nodeId, b.label, to);
                    else e.target.value = b.label;
                  }}
                  className="!w-28 font-mono !text-xs"
                  title="Branch label (edge label)"
                />
                <span className="flex-1 truncate text-[10px] text-muted">{isLLM ? "when…" : "if"}</span>
                {config.branches.length > 1 && (
                  <button type="button" onClick={() => removeBranch(nodeId, b.label)} className="rounded p-1 text-muted hover:text-rose-400" title="Remove branch and its edge">
                    <X size={12} />
                  </button>
                )}
              </div>
              <TextInput value={b.when} onChange={(e) => setWhen(b.label, e.target.value)} className="mt-1.5 font-mono !text-xs" placeholder={isLLM ? "customer wants a refund" : "decision == 'yes'"} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
