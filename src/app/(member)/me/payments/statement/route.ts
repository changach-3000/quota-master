import { getViewer } from "@/lib/session";
import { getMyLedger, getMyProfile } from "@/services/member-dashboard";
import { todayInNairobi } from "@/services/periods";

// The signed-in member's own statement. The parishioner comes only from the
// session; there is no id in the URL to tamper with.

const csvCell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

export async function GET() {
  const viewer = await getViewer();
  if (!viewer?.parishionerId) return new Response("Forbidden", { status: 403 });

  const [me, ledger] = await Promise.all([getMyProfile(viewer), getMyLedger(viewer)]);
  const today = todayInNairobi();
  const lines = [
    [`Statement for ${me?.name ?? "member"} (${me?.church ?? ""}) as at ${today}`],
    ["Date", "Period", "Type", "Reference", "Amount (KSh)"],
    ...ledger.map((e) => [
      e.receivedOn,
      e.period,
      e.isReversal ? "Correction" : e.method === "cash" ? "Cash" : "M-Pesa",
      e.reference,
      (e.amount / 100).toFixed(2),
    ]),
  ].map((r) => r.map(csvCell).join(","));

  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-giving-statement-${today}.csv"`,
      "Cache-Control": "no-store, private",
    },
  });
}
