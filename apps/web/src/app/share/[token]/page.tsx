import { Suspense } from "react";
import { SharedView } from "@/components/editor/SharedView";

export default function SharePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading…</div>}>
      <SharedView />
    </Suspense>
  );
}
