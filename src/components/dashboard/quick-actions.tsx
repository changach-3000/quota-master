import { Landmark, Plus, Target, Upload, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Panel } from "./primitives";

const ACTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/contributions/new", label: "Record payment", icon: Plus },
  { href: "/deposits", label: "Record deposit", icon: Landmark },
  { href: "/pledges", label: "Set pledge", icon: Target },
  { href: "/import", label: "Import Excel", icon: Upload },
];

export function QuickActions() {
  return (
    <Panel aria-labelledby="actions-title" className="flex flex-col gap-3.5 p-5">
      <h2 id="actions-title" className="text-base font-semibold">
        Quick actions
      </h2>
      <div className="grid grid-cols-2 gap-2.5">
        {ACTIONS.map(({ href, label, icon: Icon }) => (
          <Link
            key={label}
            href={href}
            className="flex min-h-11 flex-col gap-2 rounded-[10px] border border-border p-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Icon className="size-[18px] text-primary" strokeWidth={1.75} aria-hidden />
            {label}
          </Link>
        ))}
      </div>
    </Panel>
  );
}
