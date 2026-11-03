import { Figure, LinkButton, PageHeader, StaffPage } from "@/components/app/page";
import { Meter, Panel, StatusBadge } from "@/components/dashboard/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatKsh, percent } from "@/lib/format";
import { canWrite, requireStaffViewer } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getParishioner } from "@/services/parishioners";
import { todayInNairobi } from "@/services/periods";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SetPledgeButton } from "../../pledges/set-pledge";

export const metadata: Metadata = { title: "Parishioner" };

const METHOD = { mpesa: "M-Pesa", cash: "Cash" } as const;

export default function ParishionerPage({ params }: PageProps<"/parishioners/[id]">) {
  return (
    <StaffPage>
      <Suspense fallback={<div className="h-[600px] animate-pulse rounded-xl bg-muted" />}>
        <Detail params={params} />
      </Suspense>
    </StaffPage>
  );
}

async function Detail({ params }: { params: PageProps<"/parishioners/[id]">["params"] }) {
  const viewer = await requireStaffViewer();
  const { id } = await params;
  const p = await getParishioner(viewer, id, todayInNairobi());
  if (!p) notFound();
  const writable = canWrite(viewer);
  const pct = percent(p.balance.received, p.balance.pledged);
  const current = p.pledges.find((x) => x.isCurrent && x.period === p.period?.name);

  return (
    <>
      <PageHeader
        back={{ href: "/parishioners", label: "Parishioners" }}
        title={p.name}
        description={
          <>
            {p.church}
            {p.household && ` · ${p.household}`}
            {p.phone && ` · ${p.phone}`} · {p.hasLogin ? "Has a member login" : "No member login"}
          </>
        }
        actions={
          writable && (
            <>
              {p.period && (
                <SetPledgeButton
                  parishioner={{ id: p.id, name: p.name }}
                  period={p.period.name}
                  current={current ? { amount: current.amount, version: current.version } : null}
                  variant="secondary"
                />
              )}
              <LinkButton href="/contributions/new" icon={Plus}>
                Record payment
              </LinkButton>
            </>
          )
        }
      />

      {p.period && (
        <Panel className="flex flex-wrap items-center gap-6 p-5">
          <div className="flex min-w-0 flex-[2_1_360px] flex-col gap-2.5">
            <span className="text-[13px] font-medium text-muted-foreground">{p.period.name} pledge</span>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight tabular">{formatKsh(p.balance.received)}</span>
              <span className="text-muted-foreground tabular">{p.balance.pledged ? `paid of ${formatKsh(p.balance.pledged)}` : "given, no pledge set"}</span>
            </div>
            {p.balance.pledged > 0 && <Meter value={pct} label="Share of pledge paid" />}
          </div>
          <div className="grid flex-[1_1_280px] grid-cols-2 gap-3">
            <Figure label="Outstanding" value={formatKsh(p.balance.outstanding)} />
            <Figure label="Credit" value={formatKsh(p.balance.credit)} tone={p.balance.credit > 0 ? "positive" : undefined} />
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <Panel aria-labelledby="ledger-title" className="min-w-0 flex-[2_1_560px] overflow-hidden">
          <div className="px-5 py-[18px]">
            <h2 id="ledger-title" className="text-base font-semibold">
              Ledger
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">All payments and reversals, every period.</p>
          </div>
          <Table className="min-w-[600px] text-[13px]">
            <TableHeader>
              <TableRow className="border-t border-border bg-background hover:bg-background">
                <TableHead className="pl-5 font-medium text-muted-foreground">Received</TableHead>
                <TableHead className="font-medium text-muted-foreground">Method</TableHead>
                <TableHead className="font-medium text-muted-foreground">Period</TableHead>
                <TableHead className="font-medium text-muted-foreground">Status</TableHead>
                <TableHead className="pr-5 text-right font-medium text-muted-foreground">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.ledger.map((e) => {
                const status = e.kind === "reversal" ? "reversal" : e.reversed ? "reversed" : e.deposited ? "deposited" : "undeposited";
                return (
                  <TableRow key={e.id} className="border-slate-100">
                    <TableCell className="py-3 pl-5 whitespace-nowrap tabular">{formatDate(e.receivedOn)}</TableCell>
                    <TableCell className="py-3">
                      <span className="flex flex-col">
                        <span>{e.kind === "reversal" ? "Reversal" : e.method ? METHOD[e.method] : "—"}</span>
                        <span className="font-mono text-xs text-muted-foreground">{e.reference}</span>
                        {e.reason && <span className="text-xs text-muted-foreground">“{e.reason}”</span>}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-slate-600">{e.period}</TableCell>
                    <TableCell className="py-3">
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-3 pr-5 text-right font-semibold whitespace-nowrap tabular",
                        e.amount < 0 && "text-negative",
                        status === "reversed" && "text-muted-foreground line-through",
                      )}
                    >
                      {formatKsh(e.amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {p.ledger.length === 0 && <p className="px-5 pb-6 text-center text-muted-foreground">No payments recorded.</p>}
        </Panel>

        <Panel aria-labelledby="pledges-title" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 p-5">
          <h2 id="pledges-title" className="text-base font-semibold">
            Pledge history
          </h2>
          <p className="text-[13px] text-muted-foreground">Changing a pledge adds a new version. Old versions stay so past reports don&apos;t change.</p>
          <ol className="flex flex-col">
            {p.pledges.map((v, i) => (
              <li key={v.id} className={cn("flex items-center justify-between gap-3 py-2.5", i > 0 && "border-t border-slate-100")}>
                <span className="flex flex-col">
                  <span className="font-medium">
                    {v.period} · v{v.version}
                    {v.isCurrent && <span className="ml-2 rounded-full bg-positive-soft px-1.5 py-0.5 text-[11px] font-medium text-positive-text">Current</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">From {formatDate(v.effectiveFrom)}</span>
                </span>
                <span className={cn("font-semibold tabular", !v.isCurrent && "text-muted-foreground line-through")}>{formatKsh(v.amount)}</span>
              </li>
            ))}
          </ol>
          {p.pledges.length === 0 && <p className="text-[13px] text-muted-foreground">No pledges yet.</p>}
        </Panel>
      </div>
    </>
  );
}
