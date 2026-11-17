import { buttonClass, EmptyState, TableSkeleton } from "@/components/app/page";
import { Panel } from "@/components/dashboard/primitives";
import { MemberPage } from "@/components/member/member-page";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatKsh, referenceLabel } from "@/lib/format";
import { requireMemberViewer } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getMyLedger } from "@/services/member-dashboard";
import { Banknote, Download, Smartphone, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "My payments" };

const METHOD = { mpesa: "M-Pesa", cash: "Cash" } as const;

export default function MyPaymentsPage() {
  return (
    <MemberPage title="My payments" description="Everything the treasurer has recorded for you, in every period.">
      <Suspense fallback={<TableSkeleton />}>
        <Payments />
      </Suspense>
    </MemberPage>
  );
}

async function Payments() {
  const viewer = await requireMemberViewer();
  const ledger = await getMyLedger(viewer);
  if (ledger.length === 0) {
    return (
      <Panel>
        <EmptyState title="No payments yet">When the treasurer records a payment from you, it appears here.</EmptyState>
      </Panel>
    );
  }
  const periods = [...new Set(ledger.map((e) => e.period))];

  return (
    <>
      <div className="flex justify-end">
        <a href="/me/payments/statement" download className={buttonClass("secondary")}>
          <Download className="size-4" aria-hidden />
          Download statement (CSV)
        </a>
      </div>
      {periods.map((period) => {
        const rows = ledger.filter((e) => e.period === period);
        const total = rows.reduce((s, e) => s + e.amount, 0);
        return (
          <Panel key={period} aria-labelledby={`period-${period}`} className="overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 id={`period-${period}`} className="text-base font-semibold">
                {period}
              </h2>
              <span className="text-[13px] text-muted-foreground tabular">
                {rows.filter((r) => !r.isReversal).length} payments · {formatKsh(total)}
              </span>
            </div>
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow className="border-t border-border bg-background hover:bg-background">
                  <TableHead className="pl-5 font-medium text-muted-foreground">Date</TableHead>
                  <TableHead className="font-medium text-muted-foreground">Method</TableHead>
                  <TableHead className="hidden font-medium text-muted-foreground sm:table-cell">Reference</TableHead>
                  <TableHead className="pr-5 text-right font-medium text-muted-foreground">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => {
                  const Icon = e.isReversal ? Undo2 : e.method === "cash" ? Banknote : Smartphone;
                  return (
                    <TableRow key={e.id} className="border-slate-100">
                      <TableCell className="py-3 pl-5 whitespace-nowrap tabular">
                        {formatDate(e.receivedOn)}
                        {e.dateIsEstimated && <span className="block text-xs font-normal text-muted-foreground">date not recorded</span>}
                      </TableCell>
                      <TableCell className="py-3">
                        <span className="inline-flex items-center gap-2">
                          <Icon className={cn("size-4", e.isReversal ? "text-negative" : "text-muted-foreground")} strokeWidth={1.75} aria-hidden />
                          {e.isReversal ? "Correction" : e.method ? METHOD[e.method] : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden py-3 font-mono text-xs text-slate-600 sm:table-cell">
                        {e.isReversal ? "Reversed entry" : referenceLabel(e.method, e.reference)}
                      </TableCell>
                      <TableCell className={cn("py-3 pr-5 text-right font-semibold whitespace-nowrap tabular", e.amount < 0 && "text-negative")}>
                        {formatKsh(e.amount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter className="bg-transparent">
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={2} className="py-3 pl-5 font-medium text-muted-foreground">
                    Total for {period}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell className="py-3 pr-5 text-right font-semibold tabular">{formatKsh(total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Panel>
        );
      })}
      <p className="text-[13px] text-muted-foreground">
        Something missing or wrong? Speak to the parish treasurer. Entries are never edited; a mistake is corrected with a reversal, which shows here as a
        Correction.
      </p>
    </>
  );
}
