import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPeriodAsOf } from "./periods";
import { assertStaff, type Viewer } from "./viewer";

export type ContributionStatus = "undeposited" | "deposited" | "historical" | "reversal" | "reversed";

export type ContributionFilters = {
  q?: string;
  church?: string;
  method?: string;
  status?: string;
  page: number;
};

export type ContributionRow = {
  id: string;
  parishionerId: string;
  parishioner: string;
  church: string;
  method: "mpesa" | "cash" | null;
  reference: string;
  receivedOn: string;
  recordedAt: string;
  amount: number; // negative for reversals
  status: ContributionStatus;
  reason: string | null;
  dateIsEstimated: boolean;
};

export const PAGE_SIZE = 25;

// One expression for status so filtering and display can't disagree.
const STATUS_SQL = Prisma.sql`
  CASE
    WHEN c.kind = 'reversal' THEN 'reversal'
    WHEN EXISTS (SELECT 1 FROM contributions r WHERE r.reverses_id = c.id) THEN 'reversed'
    WHEN EXISTS (SELECT 1 FROM deposit_items di WHERE di.contribution_id = c.id) THEN 'deposited'
    WHEN c.is_historical THEN 'historical'
    ELSE 'undeposited'
  END`;

export async function listContributions(viewer: Viewer | null, f: ContributionFilters) {
  assertStaff(viewer);
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.q) {
    const like = `%${f.q.trim()}%`;
    // Matches a reversal through its original's code too, so a search shows both rows and nets to the truth.
    where.push(
      Prisma.sql`(pa.display_name ILIKE ${like} OR c.mpesa_code ILIKE ${like} OR c.receipt_no ILIKE ${like}
                  OR o.mpesa_code ILIKE ${like} OR o.receipt_no ILIKE ${like})`,
    );
  }
  if (f.church) where.push(Prisma.sql`ch.id = ${f.church}::uuid`);
  if (f.method === "mpesa" || f.method === "cash") where.push(Prisma.sql`c.method = ${f.method}::payment_method`);
  if (f.status && ["undeposited", "deposited", "historical", "reversal", "reversed"].includes(f.status)) {
    where.push(Prisma.sql`(${STATUS_SQL}) = ${f.status}`);
  }
  const whereSql = Prisma.join(where, " AND ");

  const rows = await prisma.$queryRaw<
    {
      id: string;
      parishioner_id: string;
      parishioner: string;
      church: string;
      kind: "payment" | "reversal";
      method: "mpesa" | "cash" | null;
      reference: string | null;
      received_on: string;
      recorded_at: string;
      amount_cents: bigint;
      status: ContributionStatus;
      reason: string | null;
      date_is_estimated: boolean;
    }[]
  >`
    SELECT c.id, c.parishioner_id, pa.display_name AS parishioner, ch.name AS church, c.kind, c.method,
           CASE c.kind WHEN 'reversal' THEN 'of ' || COALESCE(o.mpesa_code, o.receipt_no, 'payment')
                       ELSE COALESCE(c.mpesa_code, c.receipt_no) END AS reference,
           to_char(c.received_on, 'YYYY-MM-DD') AS received_on,
           to_char(c.recorded_at AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD"T"HH24:MI') AS recorded_at,
           c.amount_cents, ${STATUS_SQL} AS status, c.reason, c.date_is_estimated
      FROM contributions c
      JOIN parishioners pa ON pa.id = c.parishioner_id
      JOIN churches ch ON ch.id = pa.church_id
      LEFT JOIN contributions o ON o.id = c.reverses_id
     WHERE ${whereSql}
     ORDER BY c.received_on DESC, c.recorded_at DESC, c.id
     LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`;

  const [totals] = await prisma.$queryRaw<{ n: number; net: bigint }[]>`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM(CASE c.kind WHEN 'payment' THEN c.amount_cents ELSE -c.amount_cents END), 0)::bigint AS net
      FROM contributions c
      JOIN parishioners pa ON pa.id = c.parishioner_id
      JOIN churches ch ON ch.id = pa.church_id
      LEFT JOIN contributions o ON o.id = c.reverses_id
     WHERE ${whereSql}`;

  return {
    rows: rows.map(
      (r): ContributionRow => ({
        id: r.id,
        parishionerId: r.parishioner_id,
        parishioner: r.parishioner,
        church: r.church,
        method: r.method,
        reference: r.reference ?? "",
        receivedOn: r.received_on,
        recordedAt: r.recorded_at,
        amount: r.kind === "reversal" ? -Number(r.amount_cents) : Number(r.amount_cents),
        status: r.status,
        reason: r.reason,
        dateIsEstimated: r.date_is_estimated,
      }),
    ),
    total: totals.n,
    net: Number(totals.net),
  };
}

export async function listChurches(viewer: Viewer | null) {
  assertStaff(viewer);
  return prisma.churches.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** Parishioners with their current-period balance, for the record-payment picker. */
export async function listParishionerOptions(viewer: Viewer | null, asOf: string) {
  assertStaff(viewer);
  const period = await getPeriodAsOf(asOf);
  const rows = await prisma.$queryRaw<
    { id: string; name: string; church: string; pledged: bigint | null; outstanding: bigint | null }[]
  >`
    SELECT pa.id, pa.display_name AS name, ch.name AS church, b.pledged_cents AS pledged, b.outstanding_cents AS outstanding
      FROM parishioners pa
      JOIN churches ch ON ch.id = pa.church_id
      LEFT JOIN parishioner_balances b ON b.parishioner_id = pa.id AND b.period_id = ${period?.id ?? null}::uuid
     WHERE pa.is_active
     ORDER BY pa.display_name`;
  return {
    period,
    parishioners: rows.map((r) => ({
      id: r.id,
      name: r.name,
      church: r.church,
      pledged: Number(r.pledged ?? 0),
      outstanding: Number(r.outstanding ?? 0),
    })),
  };
}
