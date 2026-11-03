import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { monthIndex, type Period } from "./periods";

// Aggregates over the contributions ledger. Payments add, reversals subtract.
// Internal to services: callers must authorise before using these.

const churchFilter = (churchId?: string) =>
  churchId
    ? Prisma.sql`AND c.parishioner_id IN (SELECT id FROM parishioners WHERE church_id = ${churchId}::uuid)`
    : Prisma.empty;

/** Net collected in `period` with received_on <= upTo, optionally for one church. */
export async function netCollected(period: Period, upTo: string, churchId?: string): Promise<number> {
  const [row] = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(CASE c.kind WHEN 'payment' THEN c.amount_cents ELSE -c.amount_cents END), 0)::bigint AS total
      FROM contributions c
     WHERE c.period_id = ${period.id}::uuid
       AND c.received_on <= ${upTo}::date
       ${churchFilter(churchId)}`;
  return Number(row.total);
}

/** Net collected per month of `period` up to `upTo`; index 0 is the period's first month. */
export async function netCollectedByMonth(
  period: Period,
  upTo: string,
  months: number,
  churchId?: string,
): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ month: string; total: bigint }[]>`
    SELECT to_char(date_trunc('month', c.received_on), 'YYYY-MM-DD') AS month,
           SUM(CASE c.kind WHEN 'payment' THEN c.amount_cents ELSE -c.amount_cents END)::bigint AS total
      FROM contributions c
     WHERE c.period_id = ${period.id}::uuid
       AND c.received_on <= ${upTo}::date
       ${churchFilter(churchId)}
     GROUP BY 1`;
  const series = new Array<number>(months).fill(0);
  for (const r of rows) {
    const i = monthIndex(period, r.month);
    if (i >= 0 && i < months) series[i] = Number(r.total);
  }
  return series;
}

export async function quotaTotal(period: Period, churchId?: string): Promise<number> {
  const [row] = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
      FROM church_quotas
     WHERE period_id = ${period.id}::uuid
       ${churchId ? Prisma.sql`AND church_id = ${churchId}::uuid` : Prisma.empty}`;
  return Number(row.total);
}
