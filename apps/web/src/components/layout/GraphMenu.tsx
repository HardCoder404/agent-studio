"use client";

import { Check, Copy, Download, Link2, Link2Off, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useGraphStore } from "@/store/graph";

/** Export JSON, duplicate, and read-only share link. */
export function GraphMenu() {
  const [open, setOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const graphId = useGraphStore((s) => s.graphId);
  const name = useGraphStore((s) => s.name);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!graphId) return null;

  const exportJson = () => {
    const spec = useGraphStore.getState().toSpec();
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\w-]+/g, "-").toLowerCase() || "graph"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setOpen(false);
  };
  const duplicate = async () => {
    const g = await api.duplicateGraph(graphId);
    setOpen(false);
    router.push(`/graphs/${g.id}`);
  };
  const share = async () => {
    const { token } = await api.shareGraph(graphId);
    const url = `${window.location.origin}/share/${token}`;
    setShareUrl(url);
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const unshare = async () => {
    await api.unshareGraph(graphId);
    setShareUrl(null);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded p-1.5 text-muted hover:bg-white/5 hover:text-fg" title="More">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-edge bg-panel p-1 text-sm shadow-2xl">
          <button onClick={exportJson} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-fg hover:bg-white/5">
            <Download size={14} className="text-muted" /> Export JSON
          </button>
          <button onClick={duplicate} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-fg hover:bg-white/5">
            <Copy size={14} className="text-muted" /> Duplicate
          </button>
          <button onClick={share} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-fg hover:bg-white/5">
            {copied ? <Check size={14} className="text-emerald-300" /> : <Link2 size={14} className="text-muted" />} {copied ? "Link copied" : "Copy read-only link"}
          </button>
          {shareUrl && (
            <>
              <div className="truncate px-2 py-1 font-mono text-[10px] text-muted" title={shareUrl}>{shareUrl}</div>
              <button onClick={unshare} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-rose-300 hover:bg-white/5">
                <Link2Off size={14} /> Disable link
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
