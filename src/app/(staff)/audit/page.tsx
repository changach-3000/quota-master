import { FilterBar } from "@/components/app/filters";
import { EmptyState, PageHeader, StaffPage, TableSkeleton } from "@/components/app/page";
import { Pagination, pageParam } from "@/components/app/pagination";
import { Panel } from "@/components/dashboard/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { oneOf, param } from "@/lib/search-params";
import { requireStaffViewer } from "@/lib/session";
import { AUDIT_PAGE_SIZE, listAuditLog } from "@/services/audit";
import { CalendarClock, Lock } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Audit log" };

const ACTION_LABEL: Record<string, string> = {
  "contribution.recorded": "Recorded contribution",
  "contribution.reversed": "Reversed contribution",
  "deposit.recorded": "Recorded deposit",
  "pledge.set": "Set pledge",
  "user.invited": "Invited user",
  "user.signed_in": "Signed in",
  "import.committed": "Imported rows",
};

const label = (action: string) => ACTION_LABEL[action] ?? action.replace(/[._]/g, " ");

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <StaffPage>
      <PageHeader
        title="Audit log"
        description={
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden />
            Append-only. Entries can&apos;t be edited or deleted, even by an admin.
          </span>
        }
      />
      <Suspense fallback={<TableSkeleton />}>
        <Log searchParams={searchParams} />
      </Suspense>
    </StaffPage>
  );
}

async function Log({ searchParams }: { searchParams: PageProps<"/audit">["searchParams"] }) {
  const viewer = await requireStaffViewer();
  const sp = await searchParams;
  const filters = {
    action: param(sp.action),
    entity: param(sp.entity),
    backdated: oneOf(param(sp.backdated), ["yes"] as const),
    page: pageParam(param(sp.page)),
  };
  const result = await listAuditLog(viewer, filters);

  return (
    <>
      <FilterBar
        selects={[
          { name: "action", label: "Action", options: result.actions.map((a) => ({ value: a, label: label(a) })) },
          { name: "entity", label: "Record", options: result.entities.map((e) => ({ value: e, label: e })) },
          { name: "backdated", label: "Backdated", options: [{ value: "yes", label: "Backdated only" }] },
        ]}
      />
      <Panel className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState title="No entries match" />
        ) : (
          <Table className="min-w-[760px] text-[13px]">
            <TableHeader>
              <TableRow className="bg-background hover:bg-background">
                <TableHead className="pl-5 font-medium text-muted-foreground">When</TableHead>
                <TableHead className="font-medium text-muted-foreground">Who</TableHead>
                <TableHead className="font-medium text-muted-foreground">Action</TableHead>
                <TableHead className="font-medium text-muted-foreground">Record</TableHead>
                <TableHead className="pr-5 font-medium text-muted-foreground">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => (
                <TableRow key={r.id} className="border-slate-100">
                  <TableCell className="py-3 pl-5 whitespace-nowrap tabular">
                    <span className="flex flex-col">
                      <span>{formatDate(r.occurredAt.slice(0, 10))}</span>
                      <span className="text-xs text-muted-foreground">{r.occurredAt.slice(11, 16)} EAT</span>
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="flex flex-col">
                      <span className="font-medium">{r.actor ?? "System"}</span>
                      {r.actorRole && <span className="text-xs text-muted-foreground capitalize">{r.actorRole}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {label(r.action)}
                      {r.isBackdated && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning-text">
                          <CalendarClock className="size-3" aria-hidden />
                          Backdated
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="flex flex-col">
                      <span className="capitalize">{r.entityType}</span>
                      {r.entityId && <span className="font-mono text-xs text-muted-foreground">{r.entityId.slice(0, 8)}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 pr-5 text-slate-600 tabular">{r.summary ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={AUDIT_PAGE_SIZE} total={result.total} basePath="/audit" params={filters} />
      </Panel>
    </>
  );
}
