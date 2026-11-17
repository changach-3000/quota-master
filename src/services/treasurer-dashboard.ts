import "server-only";
import { prisma } from "@/lib/db";
import { netCollected, netCollectedByMonth, quotaTotal } from "./ledger";
import {
  getPeriodAsOf,
  getPreviousPeriod,
  monthIndex,
  oneYearEarlier,
  percentElapsed,
  type Period,
} from "./periods";
import { assertStaff, type Viewer } from "./viewer";

// Parish-wide overview for the treasurer, admin and auditor.

export type ContributionStatus = "undeposited" | "deposited" | "historical" | "reversal" | "reversed";

export type ParishOverview = {
  period: Period;
  previousPeriodName: string | null;
  asOf: string;
  percentElapsed: number;
  collected: number;
  quota: number;
  collectedLastYear: number | null;
  pledged: number;
  outstanding: number;
  credits: number;
  undeposited: { total: number; count: number; oldestOn: string | null; mpesa: { total: number; count: number }; cash: { total: number; count: number } };
  reversalsThisMonth: { total: number; count: number };
  monthly: { current: number[]; previous: number[] | null };
  churches: { name: string; quota: number; collected: number; pledged: number }[];
  recent: {
    id: string;
    parishioner: string;
    church: string;
    method: "mpesa" | "cash" | null;
    reference: string;
    receivedOn: string;
    amount: number; // negative for reversals
    status: ContributionStatus;
  }[];
  lastDeposits: { depositedOn: string; amount: number; items: number }[];
  lastDepositOn: string | null;
};

export async function getParishOverview(viewer: Viewer | null, asOf: string): Promise<ParishOverview | null> {
  assertStaff(viewer);

  const period = await getPeriodAsOf(asOf);
  if (!period) return null;
  const previous = await getPreviousPeriod(period);
  const lastYearAsOf = oneYearEarlier(asOf);
  const months = monthIndex(period, asOf) + 1;

  const [collected, quota, collectedLastYear, monthlyCurrent, monthlyPrevious] = await Promise.all([
    netCollected(period, asOf),
    quotaTotal(period),
    previous ? netCollected(previous, lastYearAsOf) : Promise.resolve(null),
    netCollectedByMonth(period, asOf, months),
    previous ? netCollectedByMonth(previous, lastYearAsOf, months) : Promise.resolve(null),
  ]);

  const [balances] = await prisma.$queryRaw<{ pledged: bigint; outstanding: bigint; credits: bigint }[]>`
    SELECT COALESCE(SUM(pledged_cents), 0)::bigint     AS pledged,
           COALESCE(SUM(outstanding_cents), 0)::bigint AS outstanding,
           COALESCE(SUM(credit_cents), 0)::bigint      AS credits
      FROM parishioner_balances
     WHERE period_id = ${period.id}::uuid`;

  // Cash on hand: payments not yet in a deposit and not reversed.
  const undepositedRows = await prisma.$queryRaw<{ method: "mpesa" | "cash"; n: number; total: bigint; oldest: string }[]>`
    SELECT c.method, COUNT(*)::int AS n, SUM(c.amount_cents)::bigint AS total, to_char(min(c.received_on), 'YYYY-MM-DD') AS oldest
      FROM contributions c
     WHERE c.kind = 'payment' AND NOT c.is_historical
       AND NOT EXISTS (SELECT 1 FROM deposit_items di WHERE di.contribution_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM contributions r WHERE r.reverses_id = c.id)
     GROUP BY c.method`;
  const byMethod = (m: "mpesa" | "cash") => {
    const r = undepositedRows.find((x) => x.method === m);
    return { total: r ? Number(r.total) : 0, count: r?.n ?? 0 };
  };
  const mpesa = byMethod("mpesa");
  const cash = byMethod("cash");

  const [reversals] = await prisma.$queryRaw<{ n: number; total: bigint }[]>`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_cents), 0)::bigint AS total
      FROM contributions
     WHERE kind = 'reversal'
       AND date_trunc('month', received_on) = date_trunc('month', ${asOf}::date)
       AND received_on <= ${asOf}::date`;

  const churchRows = await prisma.$queryRaw<{ name: string; quota: bigint; collected: bigint; pledged: bigint }[]>`
    SELECT ch.name,
           COALESCE(cq.amount_cents, 0)::bigint AS quota,
           COALESCE((SELECT SUM(CASE c.kind WHEN 'payment' THEN c.amount_cents ELSE -c.amount_cents END)
                       FROM contributions c JOIN parishioners pa ON pa.id = c.parishioner_id
                      WHERE pa.church_id = ch.id AND c.period_id = ${period.id}::uuid
                        AND c.received_on <= ${asOf}::date), 0)::bigint AS collected,
           COALESCE((SELECT SUM(pl.amount_cents)
                       FROM pledges pl JOIN parishioners pa ON pa.id = pl.parishioner_id
                      WHERE pa.church_id = ch.id AND pl.period_id = ${period.id}::uuid
                        AND pl.is_current), 0)::bigint AS pledged
      FROM churches ch
      LEFT JOIN church_quotas cq ON cq.church_id = ch.id AND cq.period_id = ${period.id}::uuid
     ORDER BY ch.name`;

  const recentRows = await prisma.$queryRaw<
    {
      id: string;
      kind: "payment" | "reversal";
      parishioner: string;
      church: string;
      method: "mpesa" | "cash" | null;
      mpesa_code: string | null;
      receipt_no: string | null;
      original_ref: string | null;
      received_on: string;
      amount_cents: bigint;
      deposited: boolean;
      reversed: boolean;
      is_historical: boolean;
    }[]
  >`
    SELECT c.id, c.kind, pa.display_name AS parishioner, ch.name AS church, c.method,
           c.mpesa_code, c.receipt_no, COALESCE(o.mpesa_code, o.receipt_no) AS original_ref,
           to_char(c.received_on, 'YYYY-MM-DD') AS received_on, c.amount_cents,
           c.is_historical,
           EXISTS (SELECT 1 FROM deposit_items di WHERE di.contribution_id = c.id) AS deposited,
           EXISTS (SELECT 1 FROM contributions r WHERE r.reverses_id = c.id)       AS reversed
      FROM contributions c
      JOIN parishioners pa ON pa.id = c.parishioner_id
      JOIN churches ch     ON ch.id = pa.church_id
      LEFT JOIN contributions o ON o.id = c.reverses_id
     WHERE c.received_on <= ${asOf}::date
     ORDER BY c.received_on DESC, c.recorded_at DESC
     LIMIT 8`;

  const depositRows = await prisma.$queryRaw<{ deposited_on: string; amount: bigint; items: number }[]>`
    SELECT to_char(d.deposited_on, 'YYYY-MM-DD') AS deposited_on, d.amount_cents AS amount,
           (SELECT COUNT(*)::int FROM deposit_items di WHERE di.deposit_id = d.id) AS items
      FROM deposits d
     WHERE d.deposited_on <= ${asOf}::date
     ORDER BY d.deposited_on DESC
     LIMIT 2`;

  return {
    period,
    previousPeriodName: previous?.name ?? null,
    asOf,
    percentElapsed: percentElapsed(period, asOf),
    collected,
    quota,
    collectedLastYear,
    pledged: Number(balances.pledged),
    outstanding: Number(balances.outstanding),
    credits: Number(balances.credits),
    undeposited: {
      total: mpesa.total + cash.total,
      count: mpesa.count + cash.count,
      oldestOn: undepositedRows.map((r) => r.oldest).sort()[0] ?? null,
      mpesa,
      cash,
    },
    reversalsThisMonth: { total: Number(reversals.total), count: reversals.n },
    monthly: { current: monthlyCurrent, previous: monthlyPrevious },
    churches: churchRows.map((r) => ({
      name: r.name,
      quota: Number(r.quota),
      collected: Number(r.collected),
      pledged: Number(r.pledged),
    })),
    recent: recentRows.map((r) => ({
      id: r.id,
      parishioner: r.parishioner,
      church: r.church,
      method: r.method,
      reference: r.kind === "reversal" ? `of ${r.original_ref ?? "payment"}` : (r.mpesa_code ?? r.receipt_no ?? ""),
      receivedOn: r.received_on,
      amount: r.kind === "reversal" ? -Number(r.amount_cents) : Number(r.amount_cents),
      status: r.kind === "reversal" ? "reversal" : r.reversed ? "reversed" : r.deposited ? "deposited" : r.is_historical ? "historical" : "undeposited",
    })),
    lastDeposits: depositRows.map((d) => ({ depositedOn: d.deposited_on, amount: Number(d.amount), items: d.items })),
    lastDepositOn: depositRows[0]?.deposited_on ?? null,
  };
}
