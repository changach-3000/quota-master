import "server-only";
import { prisma } from "@/lib/db";

export type Period = {
  id: string;
  name: string;
  startsOn: string; // ISO date
  endsOn: string;
};

type PeriodRow = { id: string; name: string; starts_on: string; ends_on: string };

const toPeriod = (r: PeriodRow): Period => ({ id: r.id, name: r.name, startsOn: r.starts_on, endsOn: r.ends_on });

/** The quota period containing `asOf` (periods never overlap). */
export async function getPeriodAsOf(asOf: string): Promise<Period | null> {
  const rows = await prisma.$queryRaw<PeriodRow[]>`
    SELECT id, name, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
      FROM quota_periods
     WHERE ${asOf}::date BETWEEN starts_on AND ends_on`;
  return rows[0] ? toPeriod(rows[0]) : null;
}

/** The latest period that ended before `period` started, for year-over-year comparisons. */
export async function getPreviousPeriod(period: Period): Promise<Period | null> {
  const rows = await prisma.$queryRaw<PeriodRow[]>`
    SELECT id, name, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
      FROM quota_periods
     WHERE ends_on < ${period.startsOn}::date
     ORDER BY ends_on DESC
     LIMIT 1`;
  return rows[0] ? toPeriod(rows[0]) : null;
}

/** Today's date in Nairobi as ISO, the parish's working day. */
export function todayInNairobi(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
}

/** Same calendar day one year earlier (29 Feb falls back to 28 Feb). */
export function oneYearEarlier(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Share of the period elapsed by `asOf`, 0–100. */
export function percentElapsed(period: Period, asOf: string): number {
  const total = (utc(period.endsOn) - utc(period.startsOn)) / DAY_MS + 1;
  const done = Math.min(Math.max((utc(asOf) - utc(period.startsOn)) / DAY_MS + 1, 0), total);
  return Math.round((done / total) * 100);
}

export function weeksRemaining(period: Period, asOf: string): number {
  return Math.max(0, Math.ceil((utc(period.endsOn) - utc(asOf)) / DAY_MS / 7));
}

/** Month offset of `iso` from the period start (0 = first month). */
export function monthIndex(period: Period, iso: string): number {
  const [sy, sm] = period.startsOn.split("-").map(Number);
  const [y, m] = iso.split("-").map(Number);
  return (y - sy) * 12 + (m - sm);
}
