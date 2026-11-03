import { cn } from "@/lib/utils";
import { CircleCheck, Clock, Undo2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Panel({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}
      {...props}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  positive: "bg-positive-soft text-positive-text",
  warning: "bg-warning-soft text-warning-text",
  negative: "bg-negative-soft text-negative",
  info: "bg-blue-50 text-blue-700",
} as const;

export function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  children,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  children?: ReactNode;
}) {
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="size-4" strokeWidth={2} aria-hidden />
        </span>
      </div>
      <div className="text-[28px] leading-tight font-semibold tracking-tight tabular">{value}</div>
      {children}
    </Panel>
  );
}

/** Accessible horizontal meter with an optional marker (e.g. share of the year elapsed). */
export function Meter({
  value,
  label,
  marker,
  markerLabel,
  size = "md",
}: {
  value: number;
  label: string;
  marker?: number;
  markerLabel?: string;
  size?: "sm" | "md" | "lg";
}) {
  const clamped = Math.min(Math.max(value, 0), 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)}%${marker !== undefined && markerLabel ? `, ${markerLabel} ${marker}%` : ""}`}
      className={cn(
        "relative rounded-full bg-muted",
        size === "sm" && "h-1.5",
        size === "md" && "h-2",
        size === "lg" && "h-2.5",
      )}
    >
      <div className="h-full rounded-full bg-positive" style={{ width: `${clamped}%` }} />
      {marker !== undefined && (
        <div
          className="absolute -top-[3px] h-[calc(100%+6px)] w-0.5 rounded-sm bg-foreground"
          style={{ left: `${marker}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}

export type Status = "undeposited" | "deposited" | "reversal" | "reversed";

const STATUS: Record<Status, { label: string; icon: LucideIcon; className: string }> = {
  undeposited: { label: "Undeposited", icon: Clock, className: "border-amber-200 bg-warning-soft text-warning-text" },
  deposited: { label: "Deposited", icon: CircleCheck, className: "border-green-200 bg-positive-soft text-positive-text" },
  reversal: { label: "Reversal", icon: Undo2, className: "border-red-200 bg-negative-soft text-negative-text" },
  reversed: { label: "Reversed", icon: Undo2, className: "border-slate-200 bg-muted text-slate-600" },
};

/** Status always pairs colour with an icon and a word. */
export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", s.className)}>
      <Icon className="size-3" strokeWidth={2} aria-hidden />
      {s.label}
    </span>
  );
}
