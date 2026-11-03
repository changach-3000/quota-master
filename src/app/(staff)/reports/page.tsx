import { buttonClass, PageHeader, StaffPage, TableSkeleton } from "@/components/app/page";
import { CollectionsChart } from "@/components/dashboard/collections-chart";
import { Meter, Panel, PanelHeader } from "@/components/dashboard/primitives";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatChange, formatDate, formatKsh, monthLabel, percent } from "@/lib/format";
import { param, uuidParam } from "@/lib/search-params";
import { requireStaffViewer } from "@/lib/session";
import { cn } from "@/lib/utils";
import { monthIndex, todayInNairobi } from "@/services/periods";
import { getChurchReport, listPeriods } from "@/services/reports";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PeriodPicker, PrintButton } from "./report-controls";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <StaffPage>
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <Report searchParams={searchParams} />
      </Suspense>
    </StaffPage>
  );
}

async function Report({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const viewer = await requireStaffViewer();
  const sp = await searchParams;
  const asOf = todayInNairobi();
  const periods = await listPeriods(viewer);
  const chosen = uuidParam(param(sp.period));
  const period = periods.find((p) => p.id === chosen) ?? periods.find((p) => p.startsOn <= asOf && asOf <= p.endsOn) ?? periods[0];
  if (!period) return <PageHeader title="Reports" description="No quota periods yet." />;

  const report = await getChurchReport(viewer, period, asOf);
  const sum = (k: "quota" | "pledged" | "collected" | "outstanding" | "credits") => report.rows.reduce((s, r) => s + r[k], 0);
  const lastYear = report.rows.every((r) => r.collectedLastYear !== null) ? report.rows.reduce((s, r) => s + (r.collectedLastYear ?? 0), 0) : null;
  const months = report.rows[0]?.monthly.length ?? 0;
  const parishMonthly = Array.from({ length: months }, (_, i) => report.rows.reduce((s, r) => s + r.monthly[i], 0));
  const labels = parishMonthly.map((_, i) => monthLabel(monthIndex(period, period.startsOn) + i));
  const final = report.upTo === period.endsOn;

  return (
    <>
      <PageHeader
        title={`${period.name} quota report`}
        description={`${formatDate(period.startsOn)} – ${formatDate(period.endsOn)} · ${final ? "final" : `as at ${formatDate(report.upTo)}`}`}
        actions={
          <>
            <PeriodPicker periods={periods.map((p) => ({ id: p.id, name: p.name }))} value={period.id} />
            <a href={`/reports/export?period=${period.id}`} className={buttonClass("secondary")} download>
              <Download className="size-4" aria-hidden />
              CSV
            </a>
            <PrintButton />
          </>
        }
      />

      <Panel aria-labelledby="church-table" className="overflow-hidden">
        <div className="px-5 py-[18px]">
          <PanelHeader id="church-table" title="By church" description="Collected is payments less reversals. Outstanding and credit are per person, then summed." />
        </div>
        <Table className="min-w-[860px] text-[13px]">
          <TableHeader>
            <TableRow className="border-t border-border bg-background hover:bg-background">
              <TableHead className="pl-5 font-medium text-muted-foreground">Church</TableHead>
              <TableHead className="text-right font-medium text-muted-foreground">Quota</TableHead>
              <TableHead className="text-right font-medium text-muted-foreground">Pledged</TableHead>
              <TableHead className="text-right font-medium text-muted-foreground">Collected</TableHead>
              <TableHead className="w-[18%] font-medium text-muted-foreground">Of quota</TableHead>
              <TableHead className="text-right font-medium text-muted-foreground">Outstanding</TableHead>
              <TableHead className="text-right font-medium text-muted-foreground">Credits</TableHead>
              <TableHead className="pr-5 text-right font-medium text-muted-foreground">
                vs {report.previous?.name ?? "last period"}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((r) => {
              const change = r.collectedLastYear !== null ? formatChange(r.collected, r.collectedLastYear) : null;
              const pct = percent(r.collected, r.quota);
              return (
                <TableRow key={r.id} className="border-slate-100">
                  <TableCell className="py-3 pl-5 font-medium">{r.name}</TableCell>
                  <TableCell className="py-3 text-right tabular">{formatKsh(r.quota)}</TableCell>
                  <TableCell className={cn("py-3 text-right tabular", r.pledged < r.quota && "text-warning-text")}>{formatKsh(r.pledged)}</TableCell>
                  <TableCell className="py-3 text-right font-semibold tabular">{formatKsh(r.collected)}</TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="grow">
                        <Meter value={pct} label={`${r.name}: share of quota collected`} size="sm" />
                      </div>
                      <span className="w-9 text-right text-xs tabular">{pct}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-3 text-right tabular">{formatKsh(r.outstanding)}</TableCell>
                  <TableCell className="py-3 text-right tabular">{formatKsh(r.credits)}</TableCell>
                  <TableCell className={cn("py-3 pr-5 text-right font-medium tabular", change?.startsWith("+") ? "text-positive-text" : "text-negative")}>
                    {change ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter className="bg-background">
            <TableRow className="hover:bg-background">
              <TableCell className="py-3 pl-5 font-semibold">Parish</TableCell>
              <TableCell className="py-3 text-right font-semibold tabular">{formatKsh(sum("quota"))}</TableCell>
              <TableCell className="py-3 text-right font-semibold tabular">{formatKsh(sum("pledged"))}</TableCell>
              <TableCell className="py-3 text-right font-semibold tabular">{formatKsh(sum("collected"))}</TableCell>
              <TableCell className="py-3 text-xs font-semibold tabular">{percent(sum("collected"), sum("quota"))}%</TableCell>
              <TableCell className="py-3 text-right font-semibold tabular">{formatKsh(sum("outstanding"))}</TableCell>
              <TableCell className="py-3 text-right font-semibold tabular">{formatKsh(sum("credits"))}</TableCell>
              <TableCell className="py-3 pr-5 text-right font-semibold tabular">
                {lastYear !== null ? formatChange(sum("collected"), lastYear) ?? "—" : "—"}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        {sum("pledged") < sum("quota") && (
          <p className="border-t border-border px-5 py-3 text-[13px] text-warning-text tabular">
            Pledges are {formatKsh(sum("quota") - sum("pledged"))} short of the parish quota.
          </p>
        )}
      </Panel>

      <Panel aria-labelledby="trend-title" className="flex flex-col gap-4 p-5 print:break-inside-avoid">
        <PanelHeader id="trend-title" title="Parish trend" description="Monthly and cumulative collections against the quota and the previous period." />
        <CollectionsChart
          labels={labels}
          current={parishMonthly}
          previous={report.previousMonthly}
          quota={sum("quota")}
          currentName={period.name}
          previousName={report.previous?.name ?? null}
        />
      </Panel>
    </>
  );
}
