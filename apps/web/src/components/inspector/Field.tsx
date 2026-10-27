"use client";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-xs text-muted">
        <span>{label}</span>
        {hint && <span className="text-[10px] text-muted/70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-edge bg-canvas px-2.5 py-1.5 text-sm text-fg outline-none focus:border-sky-500/60 disabled:opacity-50";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

/** Clickable `{{var}}` chips. */
export function VarChips({ keys, onPick, empty }: { keys: string[]; onPick: (k: string) => void; empty?: string }) {
  if (!keys.length) return empty ? <p className="text-[11px] text-muted/70">{empty}</p> : null;
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => onPick(k)} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-sky-300 hover:bg-white/10" title={`Insert {{${k}}}`}>
          {`{{${k}}}`}
        </button>
      ))}
    </div>
  );
}
