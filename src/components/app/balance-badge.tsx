import { cn } from "@/lib/utils";
import type { BalanceStatus } from "@/services/parishioners";
import { CircleCheck, CircleDashed, Clock, TrendingUp, type LucideIcon } from "lucide-react";

const STYLES: Record<BalanceStatus, { label: string; icon: LucideIcon; className: string }> = {
  complete: { label: "Complete", icon: CircleCheck, className: "border-green-200 bg-positive-soft text-positive-text" },
  "on-track": { label: "On track", icon: TrendingUp, className: "border-blue-200 bg-blue-50 text-blue-700" },
  behind: { label: "Behind", icon: Clock, className: "border-amber-200 bg-warning-soft text-warning-text" },
  "no-pledge": { label: "No pledge", icon: CircleDashed, className: "border-slate-200 bg-muted text-slate-600" },
};

export const BALANCE_STATUS_OPTIONS = (Object.keys(STYLES) as BalanceStatus[]).map((value) => ({ value, label: STYLES[value].label }));

export function BalanceBadge({ status }: { status: BalanceStatus }) {
  const s = STYLES[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.className)}>
      <Icon className="size-3" strokeWidth={2} aria-hidden />
      {s.label}
    </span>
  );
}
