"use client";

import type { CodeConfig } from "@/lib/types";
import { CodeField } from "./CodeField";
import { Field, TextInput } from "./Field";

type Props = { config: CodeConfig; vars: string[]; onChange: (patch: Partial<CodeConfig>) => void };

export function CodeForm({ config, vars, onChange }: Props) {
  return (
    <div className="space-y-3">
      <Field label="Python" hint="def main(state) -> dict of new variables">
        <CodeField language="python" value={config.source} onChange={(v) => onChange({ source: v })} height={220} />
      </Field>
      <p className="text-[11px] text-muted">
        <span className="font-mono">state</span> is a dict{vars.length ? ` with ${vars.map((v) => `"${v}"`).join(", ")}` : ""}. Return a dict; its keys become variables.
      </p>
      <Field label="Timeout (s)">
        <TextInput type="number" min={1} max={60} value={config.timeout_s} onChange={(e) => onChange({ timeout_s: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} />
      </Field>
    </div>
  );
}
