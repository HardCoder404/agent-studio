import { Suspense } from "react";
import { Editor } from "@/components/editor/Editor";

export default function EditorPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading…</div>}>
      <Editor />
    </Suspense>
  );
}
