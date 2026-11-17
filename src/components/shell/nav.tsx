"use client";

import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  Church,
  Landmark,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings2,
  Target,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

/** Section roots match their sub-pages; the two home pages match exactly. */
function isActive(pathname: string, href: string) {
  if (href === "/me" || href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavItem = { href: string; label: string; icon: LucideIcon; short?: string };
type NavSection = { title?: string; items: NavItem[] };

export const NAV: Record<"staff" | "member", NavSection[]> = {
  staff: [
    {
      title: "Overview",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/contributions", label: "Contributions", icon: ArrowLeftRight },
        { href: "/deposits", label: "Deposits", icon: Landmark },
        { href: "/pledges", label: "Pledges", icon: Target },
        { href: "/parishioners", label: "Parishioners", icon: Users },
      ],
    },
    {
      title: "Insights",
      items: [
        { href: "/reports", label: "Reports", icon: ChartNoAxesCombined },
        { href: "/audit", label: "Audit log", icon: ScrollText },
      ],
    },
    {
      title: "Data",
      items: [
        { href: "/import", label: "Import", icon: Upload },
        { href: "/settings", label: "Settings", icon: Settings2 },
      ],
    },
  ],
  member: [
    {
      items: [
        { href: "/me", label: "My giving", short: "Home", icon: LayoutDashboard },
        { href: "/me/payments", label: "My payments", short: "Payments", icon: Receipt },
        { href: "/me/pledge", label: "My pledge", short: "Pledge", icon: Target },
        { href: "/me/church", label: "Church progress", short: "Church", icon: Church },
        { href: "/me/settings", label: "Settings", icon: Settings2 },
      ],
    },
  ],
};

// Reading the current path is request-time data. Under Cache Components it
// must sit inside <Suspense> so pages (including dynamic ones like
// /parishioners/[id]) can still be prerendered; the fallback is the same menu
// with nothing highlighted.
function withPathname<P extends { pathname: string }>(View: (props: P) => React.ReactNode) {
  type Outer = Omit<P, "pathname">;
  function Live(props: Outer) {
    return <View {...(props as P)} pathname={usePathname()} />;
  }
  return function Nav(props: Outer) {
    return (
      <Suspense fallback={<View {...(props as P)} pathname="" />}>
        <Live {...props} />
      </Suspense>
    );
  };
}

/** Vertical navigation for the dark sidebar. */
export const SidebarNav = withPathname(SidebarNavView);

function SidebarNavView({ variant, badges = {}, pathname }: { variant: "staff" | "member"; badges?: Record<string, string>; pathname: string }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV[variant].map((section, i) => (
        <div key={section.title ?? i} className="flex flex-col gap-0.5">
          {section.title && (
            <span className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">
              {section.title}
            </span>
          )}
          {section.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className={cn("size-[18px]", active && "text-sidebar-primary")} strokeWidth={1.75} aria-hidden />
                <span className="grow">{item.label}</span>
                {badges[item.label] && (
                  <span className="rounded-full bg-sunshine px-1.5 text-[11px] font-semibold text-foreground tabular">
                    {badges[item.label]}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Bottom tab bar for members on phones. */
export const MemberTabBar = withPathname(MemberTabBarView);

function MemberTabBarView({ pathname }: { pathname: string }) {
  const tabs = NAV.member[0].items.filter((i) => i.label !== "Settings").slice(0, 4);
  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-10 grid grid-cols-4 print:hidden border-t border-border bg-card px-2 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      {tabs.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium",
              active ? "font-semibold text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} aria-hidden />
            {item.short ?? item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Horizontal nav for staff on narrow screens. */
export const StaffMobileNav = withPathname(StaffMobileNavView);

function StaffMobileNavView({ pathname }: { pathname: string }) {
  const items = NAV.staff.flatMap((s) => s.items);
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto bg-sidebar px-3 pb-3 lg:hidden">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 shrink-0 items-center rounded-lg px-3 text-sm font-medium",
              active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
