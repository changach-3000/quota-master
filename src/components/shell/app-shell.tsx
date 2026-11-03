import { signOut } from "@/app/login/actions";
import { Church, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { MemberTabBar, SidebarNav, StaffMobileNav } from "./nav";

function Logo({ subtitle }: { subtitle: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg px-2 py-1 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none">
      <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-positive text-white">
        <Church className="size-[18px]" strokeWidth={2} aria-hidden />
      </span>
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold text-white">Quota Master</span>
        <span className="text-xs text-sidebar-muted">{subtitle}</span>
      </span>
    </Link>
  );
}

export function ProfileChip({ initials, name, detail }: { initials: string; name: string; detail: string }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-sidebar-border px-2.5 pt-3">
      <span className="flex size-9 items-center justify-center rounded-full bg-sidebar-accent text-[13px] font-semibold text-slate-200">
        {initials}
      </span>
      <span className="flex min-w-0 grow flex-col">
        <span className="truncate text-[13px] font-medium text-white">{name}</span>
        <span className="truncate text-xs text-sidebar-muted">{detail}</span>
      </span>
      <form action={signOut}>
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="flex size-9 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-accent hover:text-white"
        >
          <LogOut className="size-[18px]" strokeWidth={1.75} aria-hidden />
        </button>
      </form>
    </div>
  );
}

/**
 * Dark sidebar + content column. Below `lg` the sidebar collapses into a
 * compact header (staff) or a bottom tab bar (members).
 */
export function AppShell({
  variant,
  subtitle,
  profile,
  badges,
  children,
}: {
  variant: "staff" | "member";
  subtitle: string;
  profile: ReactNode;
  badges?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      <aside className="hidden print:!hidden w-[248px] shrink-0 flex-col gap-6 bg-sidebar px-3.5 py-5 lg:flex lg:sticky lg:top-0 lg:h-dvh">
        <Logo subtitle={subtitle} />
        <SidebarNav variant={variant} badges={badges} />
        <div className="mt-auto">{profile}</div>
      </aside>

      <div className="bg-sidebar lg:hidden print:hidden">
        <div className="flex items-center px-3 py-3">
          <Logo subtitle={subtitle} />
        </div>
        {variant === "staff" && <StaffMobileNav />}
      </div>

      <div className="flex min-w-0 grow flex-col">{children}</div>

      {variant === "member" && <MemberTabBar />}
    </div>
  );
}
