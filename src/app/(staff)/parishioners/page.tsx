import { BALANCE_STATUS_OPTIONS, BalanceBadge } from "@/components/app/balance-badge";
import { FilterBar } from "@/components/app/filters";
import { EmptyState, Figure, PageHeader, StaffPage, TableSkeleton } from "@/components/app/page";
import { Pagination, pageParam } from "@/components/app/pagination";
import { Panel } from "@/components/dashboard/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatKsh } from "@/lib/format";
import { oneOf, param, uuidParam } from "@/lib/search-params";
import { canWrite, requireStaffViewer } from "@/lib/session";
import { listChurches } from "@/services/contributions";
import { listParishioners, PARISHIONER_PAGE_SIZE } from "@/services/parishioners";
import { getPeriodAsOf, percentElapsed, todayInNairobi } from "@/services/periods";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AddParishionerButton } from "./add-parishioner";

export const metadata: Metadata = { title: "Parishioners" };

export default function ParishionersPage({ searchParams }: PageProps<"/parishioners">) {
  return (
    <StaffPage>
      <Suspense fallback={<PageHeader title="Parishioners" />}>
        <Header />
      </Suspense>
      <Suspense fallback={<TableSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </StaffPage>
  );
}

async function Header() {
  const viewer = await requireStaffViewer();
  const churches = canWrite(viewer) ? await listChurches(viewer) : [];
  return (
    <PageHeader
      title="Parishioners"
      description="Everyone who pledges or gives, with their balance for the current period."
      actions={canWrite(viewer) && <AddParishionerButton churches={churches} />}
    />
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/parishioners">["searchParams"] }) {
  const viewer = await requireStaffViewer();
  const sp = await searchParams;
  const asOf = todayInNairobi();
  const period = await getPeriodAsOf(asOf);
  const elapsed = period ? percentElapsed(period, asOf) : 0;
  const filters = {
    q: param(sp.q),
    church: uuidParam(param(sp.church)),
    status: oneOf(param(sp.status), ["complete", "on-track", "behind", "no-pledge"] as const),
    page: pageParam(param(sp.page)),
  };
  const [churches, result] = await Promise.all([listChurches(viewer), listParishioners(viewer, asOf, elapsed, filters)]);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
        <Figure label="Active parishioners" value={String(result.counts.all)} />
        <Figure label="Pledge complete" value={String(result.counts.complete)} tone="positive" />
        <Figure label="On track" value={String(result.counts.onTrack)} note={`Within 10 points of ${elapsed}% of the year`} />
        <Figure label="Behind" value={String(result.counts.behind)} tone="warning" />
        <Figure label="No pledge" value={String(result.counts.noPledge)} />
      </div>
      <FilterBar
        searchPlaceholder="Search by name"
        selects={[
          { name: "church", label: "Church", options: churches.map((c) => ({ value: c.id, label: c.name })) },
          { name: "status", label: "Status", options: BALANCE_STATUS_OPTIONS },
        ]}
      />
      <Panel className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState title="No parishioners match">Try a different name or clear the filters.</EmptyState>
        ) : (
          <Table className="min-w-[760px] text-[13px]">
            <TableHeader>
              <TableRow className="bg-background hover:bg-background">
                <TableHead className="pl-5 font-medium text-muted-foreground">Name</TableHead>
                <TableHead className="font-medium text-muted-foreground">Last payment</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">Pledged</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">Paid</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">Outstanding</TableHead>
                <TableHead className="font-medium text-muted-foreground">Status</TableHead>
                <TableHead className="w-10 pr-5">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => (
                <TableRow key={r.id} className="group relative border-divider">
                  <TableCell className="py-3 pl-5">
                    <Link href={`/parishioners/${r.id}`} className="flex flex-col after:absolute after:inset-0 focus-visible:outline-none">
                      <span className="font-medium group-hover:underline">{r.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.church}
                        {r.household && ` · ${r.household}`}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="py-3 whitespace-nowrap text-foreground-soft tabular">{r.lastPaymentOn ? formatDate(r.lastPaymentOn) : "—"}</TableCell>
                  <TableCell className="py-3 text-right tabular">{r.pledged ? formatKsh(r.pledged) : "—"}</TableCell>
                  <TableCell className="py-3 text-right tabular">{formatKsh(r.received)}</TableCell>
                  <TableCell className="py-3 text-right font-semibold tabular">
                    {r.credit > 0 ? <span className="text-positive-text">+{formatKsh(r.credit)} credit</span> : formatKsh(r.outstanding)}
                  </TableCell>
                  <TableCell className="py-3">
                    <BalanceBadge status={r.status} />
                  </TableCell>
                  <TableCell className="py-3 pr-5 text-muted-foreground">
                    <ChevronRight className="size-4" aria-hidden />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination
          page={filters.page}
          pageSize={PARISHIONER_PAGE_SIZE}
          total={result.total}
          basePath="/parishioners"
          params={filters}
        />
      </Panel>
    </>
  );
}
