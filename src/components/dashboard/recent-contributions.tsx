import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatKsh, referenceLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Panel, StatusBadge, type Status } from "./primitives";

type Row = {
  id: string;
  parishioner: string;
  church: string;
  method: "mpesa" | "cash" | null;
  reference: string;
  receivedOn: string;
  amount: number;
  status: Status;
};

const METHOD = { mpesa: "M-Pesa", cash: "Cash" } as const;

export function RecentContributions({ rows }: { rows: Row[] }) {
  return (
    <Panel aria-labelledby="recent-title" className="min-w-0 flex-[2_1_560px] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-5 py-[18px]">
        <div>
          <h2 id="recent-title" className="text-base font-semibold">
            Recent contributions
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Ledger is append-only. Corrections appear as reversals.</p>
        </div>
        <Link href="/contributions" className="text-[13px] font-medium text-primary hover:underline">
          View all
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="border-t border-border px-5 py-8 text-center text-muted-foreground">No contributions recorded yet.</p>
      ) : (
        <Table className="min-w-[640px] text-[13px]">
          <TableHeader>
            <TableRow className="border-t border-border bg-background hover:bg-background">
              <TableHead className="pl-5 font-medium text-muted-foreground">Parishioner</TableHead>
              <TableHead className="font-medium text-muted-foreground">Method</TableHead>
              <TableHead className="font-medium text-muted-foreground">Date</TableHead>
              <TableHead className="font-medium text-muted-foreground">Status</TableHead>
              <TableHead className="pr-5 text-right font-medium text-muted-foreground">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="border-divider">
                <TableCell className="py-3 pl-5">
                  <div className="flex flex-col">
                    <span className="font-medium">{r.parishioner}</span>
                    <span className="text-xs text-muted-foreground">{r.church}</span>
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  <div className="flex flex-col">
                    <span>{r.status === "reversal" ? "Reversal" : r.method ? METHOD[r.method] : "—"}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {referenceLabel(r.method, r.reference, r.status === "reversal")}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-3 whitespace-nowrap text-foreground-soft tabular">{formatDate(r.receivedOn)}</TableCell>
                <TableCell className="py-3">
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell
                  className={cn(
                    "py-3 pr-5 text-right font-semibold whitespace-nowrap tabular",
                    r.amount < 0 && "text-negative",
                    r.status === "reversed" && "text-muted-foreground line-through",
                  )}
                >
                  {formatKsh(r.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
