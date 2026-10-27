"use client";

import type { HumanConfig } from "@/lib/types";
import { CodeField } from "./CodeField";
import { Field, TextInput } from "./Field";

type Props = { config: HumanConfig; vars: string[]; onChange: (patch: Partial<HumanConfig>) => void };

export function HumanForm({ config, vars, onChange }: Props) {
  const toggle = (k: string) =>
    onChange({ show_keys: config.show_keys.includes(k) ? config.show_keys.filter((x) => x !== k) : [...config.show_keys, k] });
  return (
    <div className="space-y-3">
      <Field label="Question" hint="may use {{vars}}">
        <CodeField language="prompt" value={config.question} onChange={(v) => onChange({ question: v })} height={60} />
      </Field>
      <Field label="Show the person" hint="variables displayed while paused">
        {vars.length ? (
          <div className="flex flex-wrap gap-1">
            {vars.map((k) => (
              <button key={k} type="button" onClick={() => toggle(k)} className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${config.show_keys.includes(k) ? "bg-pink-500/20 text-pink-200" : "bg-white/5 text-muted hover:text-fg"}`}>
                {k}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted/70">No upstream variables yet.</p>
        )}
      </Field>
      <Field label="Store answer as" hint="variable name">
        <TextInput value={config.output_key} onChange={(e) => onChange({ output_key: e.target.value.replace(/[^\w]/g, "_") })} className="font-mono" />
      </Field>
    </div>
  );
}
