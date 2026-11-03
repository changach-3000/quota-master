import { getViewer } from "@/lib/session";
import { todayInNairobi } from "@/services/periods";
import { getChurchReport, listPeriods } from "@/services/reports";
import { STAFF_ROLES } from "@/services/viewer";
import type { NextRequest } from "next/server";

// Church report as CSV. Amounts are plain shillings (two decimals) so they
// sum correctly in Excel; staff only.

const csvCell = (v: string | number) => {
  const s = String(v);
  // Quote everything and neutralise formula injection (=, +, -, @ at the start).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const shillings = (cents: number) => (cents / 100).toFixed(2);

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !STAFF_ROLES.includes(viewer.role)) return new Response("Forbidden", { status: 403 });

  const periods = await listPeriods(viewer);
  const id = request.nextUrl.searchParams.get("period");
  const period = periods.find((p) => p.id === id);
  if (!period) return new Response("Unknown period", { status: 404 });

  const report = await getChurchReport(viewer, period, todayInNairobi());
  const header = ["Church", "Quota (KSh)", "Pledged (KSh)", "Collected (KSh)", "Outstanding (KSh)", "Credits (KSh)", `Collected ${report.previous?.name ?? "previous"} same date (KSh)`];
  const lines = [
    [`${period.name} quota report as at ${report.upTo}`],
    header,
    ...report.rows.map((r) => [
      r.name,
      shillings(r.quota),
      shillings(r.pledged),
      shillings(r.collected),
      shillings(r.outstanding),
      shillings(r.credits),
      r.collectedLastYear === null ? "" : shillings(r.collectedLastYear),
    ]),
  ].map((row) => row.map(csvCell).join(","));

  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="quota-report-${period.name}-${report.upTo}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
