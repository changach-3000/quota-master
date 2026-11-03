import "server-only";
import { prisma } from "@/lib/db";
import { netCollected, netCollectedByMonth, quotaTotal } from "./ledger";
import { getPreviousPeriod, monthIndex, oneYearEarlier, type Period } from "./periods";
import { assertStaff, type Viewer } from "./viewer";

export type ChurchReportRow = {
  id: string;
  name: string;
  quota: number;
  pledged: number;
  collected: number;
  collectedLastYear: number | null;
  outstanding: number;
  credits: number;
  monthly: number[];
};

export async function listPeriods(viewer: Viewer | null): Promise<Period[]> {
  assertStaff(viewer);
  const rows = await prisma.$queryRaw<{ id: string; name: string; starts_on: string; ends_on: string }[]>`
    SELECT id, name, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
      FROM quota_periods ORDER BY starts_on DESC`;
  return rows.map((r) => ({ id: r.id, name: r.name, startsOn: r.starts_on, endsOn: r.ends_on }));
}

/**
 * Church-by-church report for a period, as at `asOf` (capped to the period end).
 * Year-over-year compares with the previous period up to the same calendar day.
 */
export async function getChurchReport(viewer: Viewer | null, period: Period, asOf: string) {
  assertStaff(viewer);
  const upTo = asOf < period.endsOn ? asOf : period.endsOn;
  const previous = await getPreviousPeriod(period);
  const months = monthIndex(period, upTo) + 1;
  const churches = await prisma.churches.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });

  const rows: ChurchReportRow[] = [];
  for (const c of churches) {
    const [quota, collected, collectedLastYear, monthly, balances] = await Promise.all([
      quotaTotal(period, c.id),
      netCollected(period, upTo, c.id),
      previous ? netCollected(previous, oneYearEarlier(upTo), c.id) : Promise.resolve(null),
      netCollectedByMonth(period, upTo, months, c.id),
      prisma.$queryRaw<{ pledged: bigint; outstanding: bigint; credits: bigint }[]>`
        SELECT COALESCE(SUM(b.pledged_cents), 0)::bigint AS pledged,
               COALESCE(SUM(b.outstanding_cents), 0)::bigint AS outstanding,
               COALESCE(SUM(b.credit_cents), 0)::bigint AS credits
          FROM parishioner_balances b JOIN parishioners pa ON pa.id = b.parishioner_id
         WHERE b.period_id = ${period.id}::uuid AND pa.church_id = ${c.id}::uuid`,
    ]);
    rows.push({
      id: c.id,
      name: c.name,
      quota,
      pledged: Number(balances[0].pledged),
      collected,
      collectedLastYear,
      outstanding: Number(balances[0].outstanding),
      credits: Number(balances[0].credits),
      monthly,
    });
  }
  const previousMonthly = previous ? await netCollectedByMonth(previous, oneYearEarlier(upTo), months) : null;
  return { period, previous, upTo, rows, previousMonthly };
}
