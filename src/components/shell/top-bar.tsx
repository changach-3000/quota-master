import { Bell, CalendarDays, ChevronDown, Search } from "lucide-react";
import type { ReactNode } from "react";

export function TopBarSearch({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex h-10 max-w-[420px] min-w-0 flex-[1_1_260px] items-center gap-2 rounded-[10px] border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-ring/40">
      <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
      <label htmlFor="global-search" className="sr-only">
        Search
      </label>
      <input
        id="global-search"
        type="search"
        placeholder={placeholder}
        className="min-w-0 grow bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export function PeriodButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="flex h-10 items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
    >
      <CalendarDays className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      {label}
      <ChevronDown className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

export function NotificationsButton({ unread = 0 }: { unread?: number }) {
  return (
    <button
      type="button"
      aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
      className="relative flex size-10 items-center justify-center rounded-[10px] border border-border bg-card hover:bg-muted"
    >
      <Bell className="size-[18px]" strokeWidth={1.75} aria-hidden />
      {unread > 0 && (
        <span className="absolute top-2 right-2 size-2 rounded-full border-2 border-card bg-warning" aria-hidden />
      )}
    </button>
  );
}

export function TopBar({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <header className="flex flex-wrap print:hidden items-center gap-3 border-b border-border bg-card px-4 py-4 sm:px-8">
      {start}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}
