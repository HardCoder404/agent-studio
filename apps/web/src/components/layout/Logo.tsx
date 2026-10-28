import { Workflow } from "lucide-react";

export function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 rounded-lg" : "h-8 w-8 rounded-[10px]";
  return (
    <span className={`grid ${box} shrink-0 place-items-center bg-accent text-accent-ink shadow-[0_0_0_1px_rgb(197_241_53/0.4),0_6px_18px_-6px_rgb(197_241_53/0.6)]`}>
      <Workflow size={size === "sm" ? 15 : 17} strokeWidth={2.4} />
    </span>
  );
}
