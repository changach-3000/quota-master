import { ChurchQuotas } from "@/components/dashboard/church-quotas";
import { CollectionsChart } from "@/components/dashboard/collections-chart";
import { DepositsPanel } from "@/components/dashboard/deposits-panel";
import { Panel, PanelHeader, StatCard } from "@/components/dashboard/primitives";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentContributions } from "@/components/dashboard/recent-contributions";
import { NotificationsButton, TopBar, TopBarSearch } from "@/components/shell/top-bar";
import { formatChange, formatDate, formatKsh, monthLabel, percent } from "@/lib/format";
import { getViewer } from "@/lib/session";
import { getParishOverview } from "@/services/treasurer-dashboard";
import { monthIndex, todayInNairobi } from "@/services/periods";
import { STAFF_ROLES } from "@/services/viewer";
import { ArrowDownLeft, Plus, Target, Undo2, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <>
      <TopBar start={<TopBarSearch placeholder="Search parishioners, M-Pesa codes, receipts" />}>
        <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-slate-600">
          Demo data
        </span>
        <NotificationsButton />
        <Suspense>
          <RecordPaymentButton />
        </Suspense>
      </TopBar>
      <Suspense fallback={<DashboardSkeleton />}>
        <Overview />
      </Suspense>
    </>
  );
}

/** Auditors are read-only, so they don't get the record button. */
async function RecordPaymentButton() {
  const viewer = await getViewer();
  if (!viewer || viewer.role === "auditor") return null;
  return (
    <Link
      href="/contributions/new"
      className="flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
    >
      <Plus className="size-4" strokeWidth={2} aria-hidden />
      Record payment
    </Link>
  );
}

async function Overview() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!STAFF_ROLES.includes(viewer.role)) redirect("/me");

  const asOf = todayInNairobi();
  const data = await getParishOverview(viewer, asOf);
  if (!data) {
    return (
      <div className="p-8">
        <Panel className="p-6">
          <h1 className="text-lg font-semibold">No quota period covers {formatDate(asOf)}</h1>
          <p className="mt-1 text-muted-foreground">Create a quota period in Settings to start tracking.</p>
        </Panel>
      </div>
    );
  }

  const quotaPct = percent(data.collected, data.quota);
  const change = data.collectedLastYear !== null ? formatChange(data.collected, data.collectedLastYear) : null;
  const pledgeGap = data.quota - data.pledged;
  const labels = data.monthly.current.map((_, i) => monthLabel(monthIndex(data.period, data.period.startsOn) + i));
  const [, , day] = asOf.split("-").map(Number);
  const canRecord = viewer.role !== "auditor";

  return (
    <div className="flex w-full max-w-[1240px] flex-col gap-6 px-4 pt-7 pb-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Parish overview</h1>
          <p className="mt-0.5 text-muted-foreground">
            {data.period.name} quota period · {formatDate(data.period.startsOn)} – {formatDate(data.period.endsOn)} · as at{" "}
            {formatDate(asOf)}
          </p>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Year elapsed <strong className="font-semibold text-foreground tabular">{data.percentElapsed}%</strong>
        </p>
      </div>

      <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
        <StatCard label="Collected this period" value={formatKsh(data.collected)} icon={ArrowDownLeft} tone="positive">
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-positive" style={{ width: `${Math.min(quotaPct, 100)}%` }} />
            </div>
            <div className="flex justify-between gap-2 text-xs text-muted-foreground tabular">
              <span>
                {quotaPct}% of {formatKsh(data.quota)} quota
              </span>
              {change && (
                <span className={change.startsWith("+") ? "font-medium text-positive-text" : "font-medium text-negative"}>
                  {change} vs {data.previousPeriodName}
                </span>
              )}
            </div>
          </div>
        </StatCard>

        <StatCard label="Undeposited funds" value={formatKsh(data.undeposited.total)} icon={Wallet} tone="warning">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-warning" aria-hidden />
              {data.undeposited.count === 0
                ? "Everything is deposited"
                : `Pending · ${data.undeposited.count} payment${data.undeposited.count === 1 ? "" : "s"}${
                    data.lastDepositOn ? ` since ${formatDate(data.lastDepositOn)}` : ""
                  }`}
            </span>
            {canRecord && data.undeposited.count > 0 && (
              <Link href="/deposits" className="font-medium text-primary hover:underline">
                Deposit
              </Link>
            )}
          </div>
        </StatCard>

        <StatCard label="Outstanding pledges" value={formatKsh(data.outstanding)} icon={Target} tone="info">
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground tabular">
            <span>
              Pledged {formatKsh(data.pledged)}
              {pledgeGap > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-warning-text">{formatKsh(pledgeGap)} below quota</span>
                </>
              )}
            </span>
            <span>Credits held {formatKsh(data.credits)}</span>
          </div>
        </StatCard>

        <StatCard
          label={`Reversals · ${new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${asOf}T00:00:00Z`))}`}
          value={formatKsh(data.reversalsThisMonth.total)}
          icon={Undo2}
          tone="negative"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {data.reversalsThisMonth.count === 0
                ? "No reversals this month"
                : `${data.reversalsThisMonth.count} reversal${data.reversalsThisMonth.count === 1 ? "" : "s"}, each with a reason`}
            </span>
            <Link href="/audit" className="font-medium text-primary hover:underline">
              Audit log
            </Link>
          </div>
        </StatCard>
      </section>

      <div className="flex flex-wrap items-stretch gap-4">
        <Panel aria-labelledby="chart-title" className="flex min-w-0 flex-[2_1_560px] flex-col gap-4 p-5">
          <PanelHeader
            id="chart-title"
            title="Collections"
            description="Payments less reversals, by month received. Hover a month for detail."
          />
          <CollectionsChart
            labels={labels}
            current={data.monthly.current}
            previous={data.monthly.previous}
            quota={data.quota}
            currentName={data.period.name}
            previousName={data.previousPeriodName}
            partialNote={`${labels.at(-1)} to date (${day} day${day === 1 ? "" : "s"})`}
          />
        </Panel>
        <ChurchQuotas churches={data.churches} elapsed={data.percentElapsed} collected={data.collected} quota={data.quota} />
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <RecentContributions rows={data.recent} />
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          {canRecord && <QuickActions />}
          <DepositsPanel undeposited={data.undeposited} lastDeposits={data.lastDeposits} />
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex w-full max-w-[1240px] flex-col gap-6 px-4 pt-7 pb-10 sm:px-8" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-12 w-72 animate-pulse rounded-lg bg-muted" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[150px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-[380px] animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
