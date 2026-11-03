import { BALANCE_STATUS_OPTIONS, BalanceBadge } from "@/components/app/balance-badge";
import { FilterBar } from "@/components/app/filters";
import { EmptyState, PageHeader, StaffPage, TableSkeleton } from "@/components/app/page";
import { Pagination, pageParam } from "@/components/app/pagination";
import { Meter, Panel } from "@/components/dashboard/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKsh, percent } from "@/lib/format";
import { oneOf, param, uuidParam } from "@/lib/search-params";
import { canWrite, requireStaffViewer } from "@/lib/session";
import { cn } from "@/lib/utils";
import { listChurches } from "@/services/contributions";
import { listParishioners, PARISHIONER_PAGE_SIZE } from "@/services/parishioners";
import { getPeriodAsOf, percentElapsed, todayInNairobi } from "@/services/periods";
import { getChurchReport } from "@/services/reports";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SetPledgeButton } from "./set-pledge";

export const metadata: Metadata = { title: "Pledges" };

export default function PledgesPage({ searchParams }: PageProps<"/pledges">) {
  return (
    <StaffPage>
      <PageHeader title="Pledges" description="What each parishioner has promised for the period, and how it adds up against each church's quota." />
      <Suspense fallback={<TableSkeleton />}>
        <Pledges searchParams={searchParams} />
      </Suspense>
    </StaffPage>
  );
}

async function Pledges({ searchParams }: { searchParams: PageProps<"/pledges">["searchParams"] }) {
  const viewer = await requireStaffViewer();
  const sp = await searchParams;
  const asOf = todayInNairobi();
  const period = await getPeriodAsOf(asOf);
  if (!period) return <EmptyState title="No open quota period">Create one in Settings first.</EmptyState>;
  const elapsed = percentElapsed(period, asOf);
  const filters = {
    q: param(sp.q),
    church: uuidParam(param(sp.church)),
    status: oneOf(param(sp.status), ["complete", "on-track", "behind", "no-pledge"] as const),
    page: pageParam(param(sp.page)),
  };
  const [churches, report, result] = await Promise.all([
    listChurches(viewer),
    getChurchReport(viewer, period, asOf),
    listParishioners(viewer, asOf, elapsed, filters),
  ]);
  const writable = canWrite(viewer);

  return (
    <>
      <section aria-label="Pledges against quota" className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
        {report.rows.map((c) => {
          const gap = c.quota - c.pledged;
          return (
            <Panel key={c.id} className="flex flex-col gap-2.5 p-5">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground tabular">Quota {formatKsh(c.quota)}</span>
              </div>
              <span className="text-xl font-semibold tracking-tight tabular">{formatKsh(c.pledged)}</span>
              <Meter value={percent(c.pledged, c.quota)} label={`${c.name}: pledges as share of quota`} size="sm" />
              <span className={cn("text-xs font-medium tabular", gap > 0 ? "text-warning-text" : "text-positive-text")}>
                {gap > 0 ? `${formatKsh(gap)} still to be pledged` : gap === 0 ? "Pledges match the quota" : `Pledged ${formatKsh(-gap)} above quota`}
              </span>
            </Panel>
          );
        })}
      </section>

      <FilterBar
        searchPlaceholder="Search by name"
        selects={[
          { name: "church", label: "Church", options: churches.map((c) => ({ value: c.id, label: c.name })) },
          { name: "status", label: "Status", options: BALANCE_STATUS_OPTIONS },
        ]}
      />

      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-[13px] tabular">
          <span className="text-muted-foreground">
            {result.total} parishioners · {period.name}
          </span>
          <span>
            Pledged <strong>{formatKsh(result.totals.pledged)}</strong> · Paid <strong>{formatKsh(result.totals.received)}</strong>
          </span>
        </div>
        {result.rows.length === 0 ? (
          <EmptyState title="No pledges match" />
        ) : (
          <Table className="min-w-[760px] text-[13px]">
            <TableHeader>
              <TableRow className="border-t border-border bg-background hover:bg-background">
                <TableHead className="pl-5 font-medium text-muted-foreground">Parishioner</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">Pledge</TableHead>
                <TableHead className="w-[28%] font-medium text-muted-foreground">Progress</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">Outstanding</TableHead>
                <TableHead className="font-medium text-muted-foreground">Status</TableHead>
                {writable && (
                  <TableHead className="pr-5">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => {
                const pct = percent(r.received, r.pledged);
                return (
                  <TableRow key={r.id} className="border-slate-100">
                    <TableCell className="py-3 pl-5">
                      <Link href={`/parishioners/${r.id}`} className="flex flex-col hover:underline">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-xs text-muted-foreground">{r.church}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="py-3 text-right tabular">
                      {r.pledged ? (
                        <span className="flex flex-col">
                          <span className="font-medium">{formatKsh(r.pledged)}</span>
                          {r.pledgeVersion && r.pledgeVersion > 1 && <span className="text-xs text-muted-foreground">v{r.pledgeVersion}</span>}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      {r.pledged > 0 ? (
                        <div className="flex items-center gap-2.5">
                          <div className="grow">
                            <Meter value={pct} label={`${r.name}: share of pledge paid`} marker={elapsed} markerLabel="year elapsed" size="sm" />
                          </div>
                          <span className="w-10 text-right text-xs text-muted-foreground tabular">{pct}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Gave {formatKsh(r.received)}</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 text-right font-semibold tabular">
                      {r.credit > 0 ? <span className="text-positive-text">+{formatKsh(r.credit)}</span> : formatKsh(r.outstanding)}
                    </TableCell>
                    <TableCell className="py-3">
                      <BalanceBadge status={r.status} />
                    </TableCell>
                    {writable && (
                      <TableCell className="py-3 pr-5 text-right">
                        <SetPledgeButton
                          parishioner={{ id: r.id, name: r.name }}
                          period={period.name}
                          current={r.pledged ? { amount: r.pledged, version: r.pledgeVersion ?? 1 } : null}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PARISHIONER_PAGE_SIZE} total={result.total} basePath="/pledges" params={filters} />
      </Panel>
    </>
  );
}
