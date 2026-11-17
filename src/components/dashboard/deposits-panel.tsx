import { formatDate, formatKsh } from "@/lib/format";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { Panel } from "./primitives";

type Bucket = { total: number; count: number };

const plural = (n: number) => `${n} payment${n === 1 ? "" : "s"}`;

export function DepositsPanel({
  undeposited,
  lastDeposits,
}: {
  undeposited: { mpesa: Bucket; cash: Bucket; count: number };
  lastDeposits: { depositedOn: string; amount: number; items: number }[];
}) {
  return (
    <Panel aria-labelledby="deposits-title" className="flex flex-col gap-3.5 p-5">
      <div className="flex items-center justify-between">
        <h2 id="deposits-title" className="text-base font-semibold">
          Deposits · NCBA
        </h2>
        <Link href="/deposits" className="text-[13px] font-medium text-primary hover:underline">
          All deposits
        </Link>
      </div>

      {undeposited.count > 0 && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-warning-border bg-warning-soft p-3 text-[13px] tabular">
          <span className="text-xs font-medium text-warning-text">Waiting to deposit</span>
          <div className="flex justify-between">
            <span className="text-foreground-soft">M-Pesa · {plural(undeposited.mpesa.count)}</span>
            <span className="font-semibold">{formatKsh(undeposited.mpesa.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-foreground-soft">Cash · {plural(undeposited.cash.count)}</span>
            <span className="font-semibold">{formatKsh(undeposited.cash.total)}</span>
          </div>
        </div>
      )}

      {lastDeposits.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No deposits recorded yet.</p>
      ) : (
        <ul className="flex flex-col">
          {lastDeposits.map((d, i) => (
            <li key={d.depositedOn} className={`flex items-center gap-3 py-2.5 ${i > 0 ? "border-t border-divider" : ""}`}>
              <CircleCheck className="size-4 shrink-0 text-positive-text" strokeWidth={2} aria-hidden />
              <span className="flex grow flex-col">
                <span className="font-medium">{formatDate(d.depositedOn)}</span>
                <span className="text-xs text-muted-foreground">Deposited · {plural(d.items)}</span>
              </span>
              <span className="font-semibold tabular">{formatKsh(d.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
