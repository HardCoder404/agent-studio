import { Suspense } from "react";
import { LandingShell } from "@/components/landing/Landing";

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading…</div>}>
      <LandingShell>{children}</LandingShell>
    </Suspense>
  );
}
