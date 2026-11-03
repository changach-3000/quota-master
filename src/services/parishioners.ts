import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPeriodAsOf, type Period } from "./periods";
import { assertStaff, type Viewer } from "./viewer";

export type BalanceStatus = "complete" | "on-track" | "behind" | "no-pledge";

export type ParishionerRow = {
  id: string;
  name: string;
  church: string;
  household: string | null;
  pledged: number;
  received: number;
  outstanding: number;
  credit: number;
  lastPaymentOn: string | null;
  pledgeVersion: number | null;
  status: BalanceStatus;
};

export type ParishionerFilters = { q?: string; church?: string; status?: string; page: number };

export const PARISHIONER_PAGE_SIZE = 25;

/** Behind = paid share of pledge is more than 10 points under the share of the year elapsed. */
function statusFor(pledged: number, received: number, elapsedPct: number): BalanceStatus {
  if (pledged === 0) return "no-pledge";
  if (received >= pledged) return "complete";
  return (received / pledged) * 100 >= elapsedPct - 10 ? "on-track" : "behind";
}

/** Staff list of parishioners with their balance for the period containing `asOf`. */
export async function listParishioners(viewer: Viewer | null, asOf: string, elapsedPct: number, f: ParishionerFilters) {
  assertStaff(viewer);
  const period = await getPeriodAsOf(asOf);
  const where: Prisma.Sql[] = [Prisma.sql`pa.is_active`];
  if (f.q) where.push(Prisma.sql`pa.display_name ILIKE ${`%${f.q.trim()}%`}`);
  if (f.church) where.push(Prisma.sql`pa.church_id = ${f.church}::uuid`);

  const rows = await prisma.$queryRaw<
    {
      id: string;
      name: string;
      church: string;
      household: string | null;
      pledged: bigint | null;
      received: bigint | null;
      outstanding: bigint | null;
      credit: bigint | null;
      last_payment_on: string | null;
      pledge_version: number | null;
    }[]
  >`
    SELECT pa.id, pa.display_name AS name, ch.name AS church, h.label AS household,
           b.pledged_cents AS pledged, b.received_cents AS received,
           b.outstanding_cents AS outstanding, b.credit_cents AS credit,
           (SELECT to_char(max(c.received_on), 'YYYY-MM-DD') FROM contributions c
             WHERE c.parishioner_id = pa.id AND c.kind = 'payment') AS last_payment_on,
           (SELECT pl.version FROM pledges pl
             WHERE pl.parishioner_id = pa.id AND pl.period_id = ${period?.id ?? null}::uuid AND pl.is_current) AS pledge_version
      FROM parishioners pa
      JOIN churches ch ON ch.id = pa.church_id
      LEFT JOIN households h ON h.id = pa.household_id
      LEFT JOIN parishioner_balances b ON b.parishioner_id = pa.id AND b.period_id = ${period?.id ?? null}::uuid
     WHERE ${Prisma.join(where, " AND ")}
     ORDER BY pa.display_name`;

  // Status depends on the elapsed share, so it is filtered after the query.
  const all = rows.map((r): ParishionerRow => {
    const pledged = Number(r.pledged ?? 0);
    const received = Number(r.received ?? 0);
    return {
      id: r.id,
      name: r.name,
      church: r.church,
      household: r.household,
      pledged,
      received,
      outstanding: Number(r.outstanding ?? 0),
      credit: Number(r.credit ?? 0),
      lastPaymentOn: r.last_payment_on,
      pledgeVersion: r.pledge_version,
      status: statusFor(pledged, received, elapsedPct),
    };
  });
  const filtered = f.status ? all.filter((r) => r.status === f.status) : all;
  const start = (f.page - 1) * PARISHIONER_PAGE_SIZE;
  return {
    period,
    rows: filtered.slice(start, start + PARISHIONER_PAGE_SIZE),
    total: filtered.length,
    totals: {
      pledged: filtered.reduce((s, r) => s + r.pledged, 0),
      received: filtered.reduce((s, r) => s + r.received, 0),
      outstanding: filtered.reduce((s, r) => s + r.outstanding, 0),
    },
    counts: {
      all: all.length,
      complete: all.filter((r) => r.status === "complete").length,
      onTrack: all.filter((r) => r.status === "on-track").length,
      behind: all.filter((r) => r.status === "behind").length,
      noPledge: all.filter((r) => r.status === "no-pledge").length,
    },
  };
}

export type PledgeVersion = {
  id: string;
  period: string;
  version: number;
  amount: number;
  effectiveFrom: string;
  isCurrent: boolean;
  createdAt: string;
};

export type LedgerEntry = {
  id: string;
  kind: "payment" | "reversal";
  period: string;
  method: "mpesa" | "cash" | null;
  reference: string;
  receivedOn: string;
  amount: number;
  reason: string | null;
  deposited: boolean;
  reversed: boolean;
};

export async function getParishioner(viewer: Viewer | null, id: string, asOf: string) {
  assertStaff(viewer);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await prisma.$queryRaw<{ id: string; name: string; phone: string | null; church: string; household: string | null; created_at: string; has_login: boolean }[]>`
    SELECT pa.id, pa.display_name AS name, pa.phone, ch.name AS church, h.label AS household,
           to_char(pa.created_at, 'YYYY-MM-DD') AS created_at,
           EXISTS (SELECT 1 FROM users u WHERE u.parishioner_id = pa.id) AS has_login
      FROM parishioners pa
      JOIN churches ch ON ch.id = pa.church_id
      LEFT JOIN households h ON h.id = pa.household_id
     WHERE pa.id = ${id}::uuid`;
  if (!p) return null;

  const period: Period | null = await getPeriodAsOf(asOf);
  const [balance] = period
    ? await prisma.$queryRaw<{ pledged_cents: bigint; received_cents: bigint; outstanding_cents: bigint; credit_cents: bigint }[]>`
        SELECT pledged_cents, received_cents, outstanding_cents, credit_cents FROM parishioner_balances
         WHERE parishioner_id = ${id}::uuid AND period_id = ${period.id}::uuid`
    : [];

  const pledges = await prisma.$queryRaw<
    { id: string; period: string; version: number; amount_cents: bigint; effective_from: string; is_current: boolean; created_at: string }[]
  >`
    SELECT pl.id, q.name AS period, pl.version, pl.amount_cents, to_char(pl.effective_from, 'YYYY-MM-DD') AS effective_from,
           pl.is_current, to_char(pl.created_at, 'YYYY-MM-DD') AS created_at
      FROM pledges pl JOIN quota_periods q ON q.id = pl.period_id
     WHERE pl.parishioner_id = ${id}::uuid
     ORDER BY q.starts_on DESC, pl.version DESC`;

  const ledger = await prisma.$queryRaw<
    {
      id: string; kind: "payment" | "reversal"; period: string; method: "mpesa" | "cash" | null; reference: string | null;
      received_on: string; amount_cents: bigint; reason: string | null; deposited: boolean; reversed: boolean;
    }[]
  >`
    SELECT c.id, c.kind, q.name AS period, c.method,
           CASE c.kind WHEN 'reversal' THEN 'of ' || COALESCE(o.mpesa_code, o.receipt_no, 'payment')
                       ELSE COALESCE(c.mpesa_code, c.receipt_no) END AS reference,
           to_char(c.received_on, 'YYYY-MM-DD') AS received_on, c.amount_cents, c.reason,
           EXISTS (SELECT 1 FROM deposit_items di WHERE di.contribution_id = c.id) AS deposited,
           EXISTS (SELECT 1 FROM contributions r WHERE r.reverses_id = c.id) AS reversed
      FROM contributions c
      JOIN quota_periods q ON q.id = c.period_id
      LEFT JOIN contributions o ON o.id = c.reverses_id
     WHERE c.parishioner_id = ${id}::uuid
     ORDER BY c.received_on DESC, c.recorded_at DESC`;

  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    church: p.church,
    household: p.household,
    since: p.created_at,
    hasLogin: p.has_login,
    period,
    balance: {
      pledged: Number(balance?.pledged_cents ?? 0),
      received: Number(balance?.received_cents ?? 0),
      outstanding: Number(balance?.outstanding_cents ?? 0),
      credit: Number(balance?.credit_cents ?? 0),
    },
    pledges: pledges.map(
      (r): PledgeVersion => ({
        id: r.id,
        period: r.period,
        version: r.version,
        amount: Number(r.amount_cents),
        effectiveFrom: r.effective_from,
        isCurrent: r.is_current,
        createdAt: r.created_at,
      }),
    ),
    ledger: ledger.map(
      (r): LedgerEntry => ({
        id: r.id,
        kind: r.kind,
        period: r.period,
        method: r.method,
        reference: r.reference ?? "",
        receivedOn: r.received_on,
        amount: r.kind === "reversal" ? -Number(r.amount_cents) : Number(r.amount_cents),
        reason: r.reason,
        deposited: r.deposited,
        reversed: r.reversed,
      }),
    ),
  };
}
