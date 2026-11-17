import { Meter, Panel } from "@/components/dashboard/primitives";
import { ChurchTrend } from "@/components/member/church-trend";
import { HowToGiveButton } from "@/components/member/how-to-give";
import { NotificationsButton, TopBar } from "@/components/shell/top-bar";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatChange, formatDate, formatKsh, monthLabel, percent, referenceLabel } from "@/lib/format";
import { getViewer } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getMemberDashboard } from "@/services/member-dashboard";
import { monthIndex, todayInNairobi } from "@/services/periods";
import { Banknote, Download, Lock, Smartphone, TrendingDown, TrendingUp, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const metadata: Metadata = { title: "My giving" };

export default function MyGivingPage() {
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <MyGiving />
    </Suspense>
  );
}

const METHOD = { mpesa: "M-Pesa", cash: "Cash" } as const;

async function MyGiving() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.parishionerId) redirect("/dashboard");

  const asOf = todayInNairobi();
  const data = await getMemberDashboard(viewer, asOf);
  if (!data) {
    return (
      <div className="p-8">
        <Panel className="p-6">
          <h1 className="text-lg font-semibold">Nothing to show yet</h1>
          <p className="mt-1 text-muted-foreground">There is no quota period for {formatDate(asOf)}.</p>
        </Panel>
      </div>
    );
  }

  const { pledge, church } = data;
  const pledgePct = percent(pledge.received, pledge.pledged);
  const churchPct = percent(church.collected, church.quota);
  const change = church.collectedLastYear !== null ? formatChange(church.collected, church.collectedLastYear) : null;
  const labels = church.monthly.map((_, i) => monthLabel(monthIndex(data.period, data.period.startsOn) + i));
  const total = data.payments.reduce((s, p) => s + p.amount, 0);
  const lastPayment = data.payments.find((p) => !p.isReversal);

  return (
    <>
      <TopBar
        start={
          <div className="flex-[1_1_240px]">
            <h1 className="text-xl font-semibold tracking-tight">My giving</h1>
            <p className="text-[13px] text-muted-foreground">
              {data.period.name} · {data.me.church} · as at {formatDate(asOf)}
            </p>
          </div>
        }
      >
        <NotificationsButton />
        <HowToGiveButton />
      </TopBar>

      <div className="flex w-full max-w-[1240px] flex-col gap-6 px-4 pt-7 pb-10 sm:px-8">
        <Panel aria-labelledby="pledge-title" className="flex flex-wrap items-center gap-8 p-6">
          <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-3.5">
            <h2 id="pledge-title" className="text-[13px] font-medium text-muted-foreground">
              My {data.period.name} pledge
            </h2>
            {pledge.pledged === 0 ? (
              <p className="text-lg">
                No pledge recorded yet. You have given <strong className="tabular">{formatKsh(pledge.received)}</strong> this period.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="text-4xl font-semibold tracking-tight tabular">{formatKsh(pledge.received)}</span>
                  <span className="text-[15px] text-muted-foreground tabular">paid of {formatKsh(pledge.pledged)}</span>
                </div>
                <Meter value={pledgePct} label="Share of my pledge paid" size="lg" />
                <div className="flex flex-wrap justify-between gap-2 text-[13px] text-muted-foreground tabular">
                  <span>
                    <strong className="font-semibold text-foreground">{pledgePct}%</strong> complete
                  </span>
                  <span>
                    {pledge.outstanding > 0
                      ? `${formatKsh(pledge.outstanding)} to go · ${data.weeksRemaining} week${data.weeksRemaining === 1 ? "" : "s"} left in ${data.period.name}`
                      : "Pledge complete. Thank you."}
                  </span>
                </div>
              </>
            )}
          </div>
          <dl className="grid flex-[1_1_280px] grid-cols-2 gap-3">
            <Tile label="Remaining" value={formatKsh(pledge.outstanding)} />
            <Tile label="Credit" value={formatKsh(pledge.credit)} />
            <Tile
              label="Last payment"
              value={lastPayment ? formatKsh(lastPayment.amount) : "None yet"}
              note={lastPayment ? formatDate(lastPayment.receivedOn) : undefined}
            />
            <Tile label="Payments" value={String(data.payments.filter((p) => !p.isReversal).length)} note="this period" />
          </dl>
        </Panel>

        <div className="flex flex-wrap items-start gap-4">
          <Panel aria-labelledby="payments-title" className="min-w-0 flex-[3_1_520px] overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-5 py-[18px]">
              <div>
                <h2 id="payments-title" className="text-base font-semibold">
                  My payments
                </h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">As recorded by the parish treasurer</p>
              </div>
              <a
                href="/me/payments/statement"
                download
                className="flex h-9 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-medium hover:bg-muted"
              >
                <Download className="size-4" strokeWidth={1.75} aria-hidden />
                Statement
              </a>
            </div>
            {data.payments.length === 0 ? (
              <p className="border-t border-border px-5 py-8 text-center text-muted-foreground">No payments recorded this period.</p>
            ) : (
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
                  {data.payments.map((p) => {
                    const Icon = p.isReversal ? Undo2 : p.method === "cash" ? Banknote : Smartphone;
                    return (
                      <TableRow key={p.id} className="border-slate-100">
                        <TableCell className="py-3 pl-5 whitespace-nowrap tabular">
                          {formatDate(p.receivedOn)}
                          {p.dateIsEstimated && <span className="block text-xs font-normal text-muted-foreground">date not recorded</span>}
                        </TableCell>
                        <TableCell className="py-3">
                          <span className="inline-flex items-center gap-2">
                            <Icon className={cn("size-4", p.isReversal ? "text-negative" : "text-muted-foreground")} strokeWidth={1.75} aria-hidden />
                            {p.isReversal ? "Correction" : p.method ? METHOD[p.method] : "—"}
                          </span>
                        </TableCell>
                        <TableCell className="hidden py-3 font-mono text-xs text-slate-600 sm:table-cell">
                          {p.isReversal ? "Reversed entry" : referenceLabel(p.method, p.reference)}
                        </TableCell>
                        <TableCell className={cn("py-3 pr-5 text-right font-semibold whitespace-nowrap tabular", p.amount < 0 && "text-negative")}>
                          {formatKsh(p.amount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter className="bg-transparent">
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={2} className="py-3 pl-5 font-medium text-muted-foreground">
                      Total paid in {data.period.name}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="py-3 pr-5 text-right font-semibold tabular">{formatKsh(total)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </Panel>

          <Panel aria-labelledby="church-title" className="flex min-w-0 flex-[2_1_360px] flex-col gap-4 p-5">
            <div>
              <h2 id="church-title" className="text-base font-semibold">
                {data.me.church} this year
              </h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Church totals toward the {data.period.name} quota</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold tracking-tight tabular">{churchPct}%</span>
                <span className="text-[13px] text-muted-foreground tabular">
                  {formatKsh(church.collected)} of {formatKsh(church.quota)}
                </span>
              </div>
              <Meter value={churchPct} label={`Share of ${data.me.church} quota collected`} />
              {change && church.collectedLastYear !== null && (
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-[13px] font-medium tabular",
                    change.startsWith("+") ? "text-positive-text" : "text-negative",
                  )}
                >
                  {change.startsWith("+") ? (
                    <TrendingUp className="size-3.5" strokeWidth={2} aria-hidden />
                  ) : (
                    <TrendingDown className="size-3.5" strokeWidth={2} aria-hidden />
                  )}
                  {change} on this time last year ({formatKsh(church.collectedLastYear)})
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Collected by month</span>
              <ChurchTrend labels={labels} values={church.monthly} churchName={data.me.church} />
            </div>
            <p className="flex gap-2.5 rounded-[10px] border border-border bg-background p-3 text-xs text-slate-600">
              <Lock className="mt-px size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              Church figures are totals only. Your own giving is visible to you, the parish treasurer and the auditor, never to other
              members.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-border bg-background p-3.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular">{value}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}

function MemberSkeleton() {
  return (
    <div className="flex w-full max-w-[1240px] flex-col gap-6 px-4 pt-7 pb-10 sm:px-8" aria-busy="true" aria-label="Loading">
      <div className="h-[180px] animate-pulse rounded-xl bg-muted" />
      <div className="h-[420px] animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
