import "server-only";
import { prisma } from "@/lib/db";
import { netCollected, netCollectedByMonth, quotaTotal } from "./ledger";
import {
  getPeriodAsOf,
  getPreviousPeriod,
  monthIndex,
  oneYearEarlier,
  weeksRemaining,
  type Period,
} from "./periods";
import { ownParishionerId, type Viewer } from "./viewer";

// The member's own giving plus church-level totals.
// Privacy rules (handoff §4): the parishioner comes from the viewer only; the
// result never carries another person's name, amount, rank or a count of
// people. Church data is sums of money, nothing else.

export type MemberDashboard = {
  period: Period;
  asOf: string;
  me: { name: string; church: string };
  pledge: { pledged: number; received: number; outstanding: number; credit: number };
  weeksRemaining: number;
  payments: {
    id: string;
    receivedOn: string;
    method: "mpesa" | "cash" | null;
    reference: string;
    amount: number; // negative for reversals
    isReversal: boolean;
  }[];
  church: {
    quota: number;
    collected: number;
    collectedLastYear: number | null;
    monthly: number[];
  };
};

export async function getMemberDashboard(viewer: Viewer | null, asOf: string): Promise<MemberDashboard | null> {
  const parishionerId = ownParishionerId(viewer);

  const [me] = await prisma.$queryRaw<{ name: string; church_id: string; church: string }[]>`
    SELECT pa.display_name AS name, pa.church_id, ch.name AS church
      FROM parishioners pa JOIN churches ch ON ch.id = pa.church_id
     WHERE pa.id = ${parishionerId}::uuid`;
  if (!me) return null;

  const period = await getPeriodAsOf(asOf);
  if (!period) return null;
  const previous = await getPreviousPeriod(period);

  const [balance] = await prisma.$queryRaw<
    { pledged_cents: bigint; received_cents: bigint; outstanding_cents: bigint; credit_cents: bigint }[]
  >`
    SELECT pledged_cents, received_cents, outstanding_cents, credit_cents
      FROM parishioner_balances
     WHERE parishioner_id = ${parishionerId}::uuid AND period_id = ${period.id}::uuid`;

  const paymentRows = await prisma.$queryRaw<
    {
      id: string;
      kind: "payment" | "reversal";
      method: "mpesa" | "cash" | null;
      reference: string | null;
      received_on: string;
      amount_cents: bigint;
    }[]
  >`
    SELECT c.id, c.kind, c.method,
           CASE c.kind WHEN 'reversal' THEN 'Correction' ELSE COALESCE(c.mpesa_code, c.receipt_no) END AS reference,
           to_char(c.received_on, 'YYYY-MM-DD') AS received_on, c.amount_cents
      FROM contributions c
     WHERE c.parishioner_id = ${parishionerId}::uuid
       AND c.period_id = ${period.id}::uuid
       AND c.received_on <= ${asOf}::date
     ORDER BY c.received_on DESC, c.recorded_at DESC`;

  const months = monthIndex(period, asOf) + 1;
  const [quota, collected, collectedLastYear, monthly] = await Promise.all([
    quotaTotal(period, me.church_id),
    netCollected(period, asOf, me.church_id),
    previous ? netCollected(previous, oneYearEarlier(asOf), me.church_id) : Promise.resolve(null),
    netCollectedByMonth(period, asOf, months, me.church_id),
  ]);

  return {
    period,
    asOf,
    me: { name: me.name, church: me.church },
    pledge: {
      pledged: Number(balance?.pledged_cents ?? 0),
      received: Number(balance?.received_cents ?? 0),
      outstanding: Number(balance?.outstanding_cents ?? 0),
      credit: Number(balance?.credit_cents ?? 0),
    },
    weeksRemaining: weeksRemaining(period, asOf),
    payments: paymentRows.map((p) => ({
      id: p.id,
      receivedOn: p.received_on,
      method: p.method,
      reference: p.reference ?? "",
      amount: p.kind === "reversal" ? -Number(p.amount_cents) : Number(p.amount_cents),
      isReversal: p.kind === "reversal",
    })),
    church: { quota, collected, collectedLastYear, monthly },
  };
}

/** Name and church for the viewer's own profile chip. */
export async function getMyProfile(viewer: Viewer | null): Promise<{ name: string; church: string; email: string; phone: string | null } | null> {
  const parishionerId = ownParishionerId(viewer);
  const [me] = await prisma.$queryRaw<{ name: string; church: string; email: string; phone: string | null }[]>`
    SELECT pa.display_name AS name, ch.name AS church, u.email, pa.phone
      FROM parishioners pa
      JOIN churches ch ON ch.id = pa.church_id
      JOIN users u ON u.id = ${viewer!.userId}::uuid AND u.parishioner_id = pa.id
     WHERE pa.id = ${parishionerId}::uuid`;
  return me ?? null;
}

export type MyLedgerEntry = {
  id: string;
  period: string;
  receivedOn: string;
  method: "mpesa" | "cash" | null;
  reference: string;
  amount: number; // negative for reversals
  isReversal: boolean;
};

/** Every one of the viewer's own payments and corrections, all periods. */
export async function getMyLedger(viewer: Viewer | null): Promise<MyLedgerEntry[]> {
  const parishionerId = ownParishionerId(viewer);
  const rows = await prisma.$queryRaw<
    { id: string; period: string; received_on: string; method: "mpesa" | "cash" | null; reference: string | null; kind: "payment" | "reversal"; amount_cents: bigint }[]
  >`
    SELECT c.id, q.name AS period, to_char(c.received_on, 'YYYY-MM-DD') AS received_on, c.method,
           CASE c.kind WHEN 'reversal' THEN 'Correction' ELSE COALESCE(c.mpesa_code, c.receipt_no) END AS reference,
           c.kind, c.amount_cents
      FROM contributions c JOIN quota_periods q ON q.id = c.period_id
     WHERE c.parishioner_id = ${parishionerId}::uuid
     ORDER BY c.received_on DESC, c.recorded_at DESC`;
  return rows.map((r) => ({
    id: r.id,
    period: r.period,
    receivedOn: r.received_on,
    method: r.method,
    reference: r.reference ?? "",
    amount: r.kind === "reversal" ? -Number(r.amount_cents) : Number(r.amount_cents),
    isReversal: r.kind === "reversal",
  }));
}

/** The viewer's own pledges, each period with its versions, newest first. */
export async function getMyPledges(viewer: Viewer | null) {
  const parishionerId = ownParishionerId(viewer);
  const rows = await prisma.$queryRaw<
    { period: string; starts_on: string; version: number; amount_cents: bigint; effective_from: string; is_current: boolean; received: bigint | null }[]
  >`
    SELECT q.name AS period, to_char(q.starts_on, 'YYYY-MM-DD') AS starts_on, pl.version, pl.amount_cents,
           to_char(pl.effective_from, 'YYYY-MM-DD') AS effective_from, pl.is_current, b.received_cents AS received
      FROM pledges pl
      JOIN quota_periods q ON q.id = pl.period_id
      LEFT JOIN parishioner_balances b ON b.parishioner_id = pl.parishioner_id AND b.period_id = pl.period_id
     WHERE pl.parishioner_id = ${parishionerId}::uuid
     ORDER BY q.starts_on DESC, pl.version DESC`;
  return rows.map((r) => ({
    period: r.period,
    version: r.version,
    amount: Number(r.amount_cents),
    effectiveFrom: r.effective_from,
    isCurrent: r.is_current,
    received: Number(r.received ?? 0),
  }));
}
