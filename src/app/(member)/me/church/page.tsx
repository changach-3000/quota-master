import { Figure, TableSkeleton } from "@/components/app/page";
import { Meter, Panel, PanelHeader } from "@/components/dashboard/primitives";
import { ChurchTrend } from "@/components/member/church-trend";
import { MemberPage } from "@/components/member/member-page";
import { formatChange, formatKsh, monthLabel, percent } from "@/lib/format";
import { requireMemberViewer } from "@/lib/session";
import { getMemberDashboard } from "@/services/member-dashboard";
import { monthIndex, percentElapsed, todayInNairobi } from "@/services/periods";
import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Church progress" };

export default function ChurchProgressPage() {
  return (
    <MemberPage title="Church progress" description="How your church is doing toward its share of the parish quota.">
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <Progress />
      </Suspense>
    </MemberPage>
  );
}

// Totals only: this page never shows people, counts of people, or rankings.
async function Progress() {
  const viewer = await requireMemberViewer();
  const asOf = todayInNairobi();
  const data = await getMemberDashboard(viewer, asOf);
  if (!data) return <Panel className="p-6 text-muted-foreground">No quota period is open.</Panel>;
  const { church, period } = data;
  const pct = percent(church.collected, church.quota);
  const elapsed = percentElapsed(period, asOf);
  const change = church.collectedLastYear !== null ? formatChange(church.collected, church.collectedLastYear) : null;
  const labels = church.monthly.map((_, i) => monthLabel(monthIndex(period, period.startsOn) + i));
  const remaining = Math.max(church.quota - church.collected, 0);

  return (
    <>
      <Panel className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-medium text-muted-foreground">
            {data.me.church} · {period.name} quota
          </h2>
          <span className="text-[13px] text-muted-foreground">Marker shows how much of the year has passed ({elapsed}%)</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-4xl font-semibold tracking-tight tabular">{pct}%</span>
          <span className="text-muted-foreground tabular">
            {formatKsh(church.collected)} of {formatKsh(church.quota)}
          </span>
        </div>
        <Meter value={pct} label={`${data.me.church}: share of quota collected`} marker={elapsed} markerLabel="year elapsed" size="lg" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Figure label="Still to raise" value={formatKsh(remaining)} />
          <Figure
            label="Same time last year"
            value={church.collectedLastYear !== null ? formatKsh(church.collectedLastYear) : "—"}
            note={change ? `${change} this year` : undefined}
            tone={change?.startsWith("+") ? "positive" : undefined}
          />
          <Figure label="Weeks left" value={String(data.weeksRemaining)} />
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3 p-5">
        <PanelHeader id="trend-title" title="Collected by month" description="Church totals. The latest month is still in progress." />
        <ChurchTrend labels={labels} values={church.monthly} churchName={data.me.church} />
      </Panel>

      <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        These are totals for the whole church. Nobody&apos;s individual giving is shown to other members, and yours is visible only to you, the treasurer
        and the auditor.
      </p>
    </>
  );
}
