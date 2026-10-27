"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

export function BottomPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className={`shrink-0 border-t border-edge bg-panel transition-[height] ${open ? "h-56" : "h-9"}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex h-9 w-full items-center gap-2 px-3 text-xs text-muted hover:text-fg">
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        <span className="font-medium uppercase tracking-wider">Console</span>
        <span className="text-muted/70">run events will appear here</span>
      </button>
    </section>
  );
}
