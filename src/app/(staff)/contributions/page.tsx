import { FilterBar } from "@/components/app/filters";
import { EmptyState, LinkButton, PageHeader, StaffPage, TableSkeleton } from "@/components/app/page";
import { Pagination, pageParam } from "@/components/app/pagination";
import { Panel, StatusBadge } from "@/components/dashboard/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatKsh } from "@/lib/format";
import { oneOf, param, uuidParam } from "@/lib/search-params";
import { canWrite, requireStaffViewer } from "@/lib/session";
import { cn } from "@/lib/utils";
import { listChurches, listContributions, PAGE_SIZE } from "@/services/contributions";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReverseButton } from "./reverse-dialog";

export const metadata: Metadata = { title: "Contributions" };

const METHOD = { mpesa: "M-Pesa", cash: "Cash" } as const;

export default function ContributionsPage({ searchParams }: PageProps<"/contributions">) {
  return (
    <StaffPage>
      <Suspense fallback={<PageHeader title="Contributions" description="Every payment and reversal, newest first." />}>
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
  return (
    <PageHeader
      title="Contributions"
      description="Every payment and reversal, newest first. The ledger is append-only."
      actions={
        canWrite(viewer) && (
          <LinkButton href="/contributions/new" icon={Plus}>
            Record payment
          </LinkButton>
        )
      }
    />
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/contributions">["searchParams"] }) {
  const viewer = await requireStaffViewer();
  const sp = await searchParams;
  const filters = {
    q: param(sp.q),
    church: uuidParam(param(sp.church)),
    method: oneOf(param(sp.method), ["mpesa", "cash"] as const),
    status: oneOf(param(sp.status), ["undeposited", "deposited", "reversal", "reversed"] as const),
    page: pageParam(param(sp.page)),
  };
  const [churches, result] = await Promise.all([listChurches(viewer), listContributions(viewer, filters)]);
  const writable = canWrite(viewer);

  return (
    <>
      <FilterBar
        searchPlaceholder="Parishioner, M-Pesa code or receipt"
        selects={[
          { name: "church", label: "Church", options: churches.map((c) => ({ value: c.id, label: c.name })) },
          { name: "method", label: "Method", options: [{ value: "mpesa", label: "M-Pesa" }, { value: "cash", label: "Cash" }] },
          {
            name: "status",
            label: "Status",
            options: [
              { value: "undeposited", label: "Undeposited" },
              { value: "deposited", label: "Deposited" },
              { value: "reversal", label: "Reversal" },
              { value: "reversed", label: "Reversed" },
            ],
          },
        ]}
      />
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-[13px]">
          <span className="text-muted-foreground tabular">
            {result.total.toLocaleString("en-KE")} entr{result.total === 1 ? "y" : "ies"}
          </span>
          <span className="tabular">
            Net total <strong className="font-semibold">{formatKsh(result.net)}</strong>
          </span>
        </div>
        {result.rows.length === 0 ? (
          <EmptyState title="No contributions match">Try a different search or clear the filters.</EmptyState>
        ) : (
          <Table className="min-w-[760px] text-[13px]">
            <TableHeader>
              <TableRow className="border-t border-border bg-background hover:bg-background">
                <TableHead className="pl-5 font-medium text-muted-foreground">Parishioner</TableHead>
                <TableHead className="font-medium text-muted-foreground">Method</TableHead>
                <TableHead className="font-medium text-muted-foreground">Received</TableHead>
                <TableHead className="font-medium text-muted-foreground">Status</TableHead>
                <TableHead className="text-right font-medium text-muted-foreground">Amount</TableHead>
                {writable && <TableHead className="w-28 pr-5"><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => (
                <TableRow key={r.id} className="border-slate-100">
                  <TableCell className="py-3 pl-5">
                    <Link href={`/parishioners/${r.parishionerId}`} className="flex flex-col hover:underline">
                      <span className="font-medium">{r.parishioner}</span>
                      <span className="text-xs text-muted-foreground">{r.church}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex flex-col">
                      <span>{r.status === "reversal" ? "Reversal" : r.method ? METHOD[r.method] : "—"}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {r.method === "cash" && r.status !== "reversal" ? `Receipt ${r.reference}` : r.reference}
                      </span>
                      {r.reason && <span className="text-xs text-muted-foreground">“{r.reason}”</span>}
                    </div>
                  </TableCell>
                  <TableCell className="py-3 whitespace-nowrap text-slate-600 tabular">{formatDate(r.receivedOn)}</TableCell>
                  <TableCell className="py-3">
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "py-3 text-right font-semibold whitespace-nowrap tabular",
                      r.amount < 0 && "text-negative",
                      r.status === "reversed" && "text-muted-foreground line-through",
                    )}
                  >
                    {formatKsh(r.amount)}
                  </TableCell>
                  {writable && (
                    <TableCell className="py-3 pr-5 text-right">
                      {(r.status === "undeposited" || r.status === "deposited") && (
                        <ReverseButton
                          contribution={{
                            parishioner: r.parishioner,
                            amount: r.amount,
                            reference: r.reference,
                            receivedOn: r.receivedOn,
                            deposited: r.status === "deposited",
                          }}
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={result.total} basePath="/contributions" params={filters} />
      </Panel>
    </>
  );
}
