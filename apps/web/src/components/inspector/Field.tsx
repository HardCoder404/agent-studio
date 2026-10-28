"use client";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[11.5px] font-medium text-muted">
        <span>{label}</span>
        {hint && <span className="font-mono text-[10px] font-normal text-dim">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputCls = "input";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

/** Clickable `{{var}}` chips. */
export function VarChips({ keys, onPick, empty }: { keys: string[]; onPick: (k: string) => void; empty?: string }) {
  if (!keys.length) return empty ? <p className="text-[11px] text-dim">{empty}</p> : null;
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => onPick(k)} className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-accent transition hover:bg-accent/20" title={`Insert {{${k}}}`}>
          {`{{${k}}}`}
        </button>
      ))}
    </div>
  );
}
