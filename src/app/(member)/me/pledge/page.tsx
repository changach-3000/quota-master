import { EmptyState, Figure, TableSkeleton } from "@/components/app/page";
import { Meter, Panel } from "@/components/dashboard/primitives";
import { MemberPage } from "@/components/member/member-page";
import { formatDate, formatKsh, percent } from "@/lib/format";
import { requireMemberViewer } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getMemberDashboard, getMyPledges } from "@/services/member-dashboard";
import { todayInNairobi } from "@/services/periods";
import { Info } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "My pledge" };

export default function MyPledgePage() {
  return (
    <MemberPage title="My pledge" description="What you have promised to give, and how you are doing.">
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <Pledge />
      </Suspense>
    </MemberPage>
  );
}

async function Pledge() {
  const viewer = await requireMemberViewer();
  const asOf = todayInNairobi();
  const [data, pledges] = await Promise.all([getMemberDashboard(viewer, asOf), getMyPledges(viewer)]);
  const periods = [...new Set(pledges.map((p) => p.period))];

  return (
    <>
      {data && data.pledge.pledged > 0 ? (
        <Panel aria-labelledby="current-title" className="flex flex-col gap-5 p-6">
          <h2 id="current-title" className="text-[13px] font-medium text-muted-foreground">
            {data.period.name} pledge
          </h2>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="text-4xl font-semibold tracking-tight tabular">{formatKsh(data.pledge.pledged)}</span>
            <span className="text-muted-foreground">for {data.period.name}</span>
          </div>
          <Meter value={percent(data.pledge.received, data.pledge.pledged)} label="Share of my pledge paid" size="lg" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            <Figure label="Paid so far" value={formatKsh(data.pledge.received)} />
            <Figure label="Still to give" value={formatKsh(data.pledge.outstanding)} />
            <Figure label="Credit" value={formatKsh(data.pledge.credit)} tone={data.pledge.credit > 0 ? "positive" : undefined} />
            <Figure
              label="Weeks left"
              value={String(data.weeksRemaining)}
              note={
                data.pledge.outstanding > 0 && data.weeksRemaining > 0
                  ? `About ${formatKsh(Math.ceil(data.pledge.outstanding / data.weeksRemaining / 100) * 100)} a week`
                  : undefined
              }
            />
          </div>
        </Panel>
      ) : (
        <Panel>
          <EmptyState title="No pledge for this period yet">Speak to the parish treasurer to set one.</EmptyState>
        </Panel>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <Panel aria-labelledby="history-title" className="flex min-w-0 flex-[2_1_420px] flex-col gap-3 p-5">
          <h2 id="history-title" className="text-base font-semibold">
            Pledge history
          </h2>
          {periods.length === 0 && <p className="text-[13px] text-muted-foreground">No pledges recorded.</p>}
          {periods.map((period) => {
            const versions = pledges.filter((p) => p.period === period);
            const current = versions.find((v) => v.isCurrent) ?? versions[0];
            return (
              <div key={period} className="flex flex-col gap-2 rounded-[10px] border border-border p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{period}</span>
                  <span className="text-[13px] text-muted-foreground tabular">
                    Paid {formatKsh(current.received)} of {formatKsh(current.amount)}
                  </span>
                </div>
                <ol className="flex flex-col gap-1 text-[13px]">
                  {versions.map((v) => (
                    <li key={v.version} className="flex justify-between gap-2">
                      <span className={cn(!v.isCurrent && "text-muted-foreground")}>
                        {v.isCurrent ? "Current" : `Earlier (v${v.version})`} · from {formatDate(v.effectiveFrom)}
                      </span>
                      <span className={cn("tabular", v.isCurrent ? "font-semibold" : "text-muted-foreground line-through")}>{formatKsh(v.amount)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </Panel>
        <Panel className="flex min-w-0 flex-[1_1_280px] gap-3 p-5 text-[13px] text-slate-700">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-2">
            <p className="font-medium text-foreground">About pledges</p>
            <p>Your pledge is what you hope to give toward your church&apos;s share of the parish quota this year.</p>
            <p>If you give more than you pledged, the extra is kept as credit, not lost.</p>
            <p>To change your pledge, speak to the treasurer. The old amount is kept on record.</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
