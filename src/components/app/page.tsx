import { NotificationsButton, TopBar, TopBarSearch } from "@/components/shell/top-bar";
import { cn } from "@/lib/utils";
import { Inbox, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** Standard staff page chrome: search bar, then a padded body. */
export function StaffPage({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar start={<TopBarSearch placeholder="Search parishioners, M-Pesa codes, receipts" />}>
        <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground-soft">
          Demo data
        </span>
        <NotificationsButton />
      </TopBar>
      <PageBody>{children}</PageBody>
    </>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex w-full max-w-[1240px] flex-col gap-6 px-4 pt-7 pb-10 sm:px-8", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col gap-2">
      {back && (
        <Link href={back.href} className="w-fit text-[13px] font-medium text-primary hover:underline">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const BUTTON = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "border border-border bg-card text-foreground hover:bg-muted",
  danger: "border border-negative-border bg-card text-negative-text hover:bg-negative-soft",
} as const;

export function buttonClass(variant: keyof typeof BUTTON = "primary", className?: string) {
  return cn(
    "inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-medium transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-50",
    BUTTON[variant],
    className,
  );
}

export function LinkButton({
  href,
  icon: Icon,
  variant = "primary",
  children,
}: {
  href: string;
  icon?: LucideIcon;
  variant?: keyof typeof BUTTON;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant)}>
      {Icon && <Icon className="size-4" strokeWidth={2} aria-hidden />}
      {children}
    </Link>
  );
}

export function EmptyState({ title, children, icon: Icon = Inbox }: { title: string; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-sm text-[13px] text-muted-foreground">{children}</p>}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      <div className="h-11 animate-pulse rounded-lg bg-muted" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/70" />
      ))}
    </div>
  );
}

/** Summary figure used in page-level stat strips. */
export function Figure({ label, value, note, tone }: { label: string; value: string; note?: ReactNode; tone?: "warning" | "negative" | "positive" }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-xl font-semibold tracking-tight tabular",
          tone === "warning" && "text-warning-text",
          tone === "negative" && "text-negative",
          tone === "positive" && "text-positive-text",
        )}
      >
        {value}
      </span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
