import { EmptyState, Figure, PageHeader, StaffPage, TableSkeleton } from "@/components/app/page";
import { Panel } from "@/components/dashboard/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatKsh } from "@/lib/format";
import { canWrite, requireStaffViewer } from "@/lib/session";
import { listDeposits, listUndeposited } from "@/services/deposits";
import { todayInNairobi } from "@/services/periods";
import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { DepositBuilder } from "./deposit-builder";

export const metadata: Metadata = { title: "Deposits" };

export default function DepositsPage() {
  return (
    <StaffPage>
      <PageHeader title="Deposits" description="Bank the money you have received, and see what went into each NCBA deposit." />
      <Suspense fallback={<TableSkeleton />}>
        <Deposits />
      </Suspense>
    </StaffPage>
  );
}

async function Deposits() {
  const viewer = await requireStaffViewer();
  const [waiting, all] = await Promise.all([listUndeposited(viewer), listDeposits(viewer, 1000)]);
  const history = all.slice(0, 24);
  const waitingTotal = waiting.reduce((s, p) => s + p.amount, 0);
  const oldest = waiting[0]?.receivedOn;
  const thisYear = todayInNairobi().slice(0, 4);
  const bankedThisYear = all.filter((d) => d.depositedOn.startsWith(thisYear)).reduce((s, d) => s + d.amount, 0);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Figure label="Waiting to deposit" value={formatKsh(waitingTotal)} tone={waitingTotal > 0 ? "warning" : undefined} note={`${waiting.length} payments`} />
        <Figure label="Oldest waiting" value={oldest ? formatDate(oldest) : "—"} note="Received on" />
        <Figure label="Last deposit" value={history[0] ? formatDate(history[0].depositedOn) : "—"} note={history[0] ? formatKsh(history[0].amount) : undefined} />
        <Figure label={`Banked in ${thisYear}`} value={formatKsh(bankedThisYear)} note={`${all.filter((d) => d.depositedOn.startsWith(thisYear)).length} deposits`} />
      </div>

      {canWrite(viewer) ? (
        <DepositBuilder payments={waiting} today={todayInNairobi()} />
      ) : (
        <Panel className="p-5 text-[13px] text-muted-foreground">
          {waiting.length} payments ({formatKsh(waitingTotal)}) are waiting to be deposited. Auditors can view deposits but not record them.
        </Panel>
      )}

      <Panel aria-labelledby="history-title" className="overflow-hidden">
        <div className="px-5 py-[18px]">
          <h2 id="history-title" className="text-base font-semibold">
            Deposit history
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Latest 24. Each deposit&apos;s amount must equal the payments in it; the database checks this.</p>
        </div>
        {history.length === 0 ? (
          <EmptyState title="No deposits yet" />
        ) : (
          <Table className="min-w-[640px] text-[13px]">
            <TableHeader>
              <TableRow className="border-t border-border bg-background hover:bg-background">
                <TableHead className="pl-5 font-medium text-muted-foreground">Date</TableHead>
                <TableHead className="font-medium text-muted-foreground">Bank reference</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">M-Pesa</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">Cash</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">Payments</TableHead>
                <TableHead className="pr-5 text-right font-medium text-muted-foreground">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((d) => (
                <TableRow key={d.id} className="border-slate-100">
                  <TableCell className="py-3 pl-5">
                    <span className="inline-flex items-center gap-2 font-medium whitespace-nowrap">
                      <CircleCheck className="size-4 text-positive-text" strokeWidth={2} aria-hidden />
                      {formatDate(d.depositedOn)}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="flex flex-col">
                      <span className="font-mono text-xs">{d.bankRef ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">{d.bankAccount}</span>
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-right text-slate-600 tabular">{formatKsh(d.mpesa)}</TableCell>
                  <TableCell className="py-3 text-right text-slate-600 tabular">{formatKsh(d.cash)}</TableCell>
                  <TableCell className="py-3 text-right tabular">{d.items}</TableCell>
                  <TableCell className="py-3 pr-5 text-right font-semibold tabular">{formatKsh(d.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </>
  );
}
